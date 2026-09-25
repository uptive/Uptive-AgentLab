// Fixture: a completed run of `Planner → [Code Reviewer || Security Reviewer] → Final Validator`.
// Stand-in until Group 1 (agents) and Group 3 (runs) have real data. Built on the shared contracts.
//
// Input mappings use the flow engine's format (see `buildNodeInput` in @agentlab/flow-engine):
//   "$input.<field>"    → field of the run's initial input
//   "<nodeId>.<path>"   → field of an upstream node's output ("<nodeId>" for the whole output)
//
// Deliberate problems baked in for the evaluators to find:
//   - Planner runs on a strong, expensive model for a small structured-planning step.
//   - Planner and Final Validator both receive the full diff although they don't need it.
//   - Security Reviewer has vague instructions, no output schema and a weak model; it hit a
//     retry and returned prose, so the validator's `securityFindings` mapping resolved to nothing.
//   - The run input is a one-liner with no acceptance criteria.
//   - Security Reviewer waits for Code Reviewer (dependsOn) but never reads its output, so the
//     two reviews run back to back instead of in parallel.
import type { AgentDefinition, FlowDefinition, Run, StepRun, TraceEvent, Usage } from "@agentlab/contracts";
import { estimateCostUsd, getModel } from "../modelCatalog.js";
import type { EvaluationInput } from "../types.js";

const RUN_ID = "run_fixture_pr482";
const FLOW_ID = "flow_pr_review";
const T0 = Date.parse("2026-09-23T14:02:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function usage(model: string, inputTokens: number, outputTokens: number, latencyMs: number): Usage {
  return { inputTokens, outputTokens, latencyMs, estimatedCostUsd: estimateCostUsd(getModel(model)!, { inputTokens, outputTokens }) };
}

const TASK = "Review PR #482 before merge.";

const DIFF = `diff --git a/services/auth/src/routes/passwordReset.ts b/services/auth/src/routes/passwordReset.ts
new file mode 100644
--- /dev/null
+++ b/services/auth/src/routes/passwordReset.ts
@@ -0,0 +1,58 @@
+import { Router } from "express";
+import crypto from "node:crypto";
+import { db } from "../db";
+import { mailer } from "../mailer";
+import { logger } from "../logger";
+import { hashPassword } from "../crypto";
+
+export const passwordResetRouter = Router();
+
+passwordResetRouter.post("/password-reset/request", async (req, res) => {
+  const { email } = req.body;
+  const user = await db.users.findByEmail(email);
+  if (!user) {
+    return res.status(404).json({ error: "No account with that email" });
+  }
+  const token = crypto.randomBytes(16).toString("hex");
+  await db.passwordResets.insert({ userId: user.id, token, createdAt: new Date() });
+  logger.info(\`Password reset requested for \${email}, token=\${token}\`);
+  await mailer.send(email, "Reset your password", \`https://app.example.com/reset?token=\${token}\`);
+  res.json({ ok: true });
+});
+
+passwordResetRouter.post("/password-reset/confirm", async (req, res) => {
+  const { token, newPassword } = req.body;
+  const reset = await db.passwordResets.findByToken(token);
+  if (!reset) {
+    return res.status(400).json({ error: "Invalid token" });
+  }
+  const user = await db.users.findById(reset.userId);
+  user.passwordHash = await hashPassword(newPassword);
+  await db.users.save(user);
+  res.json({ ok: true });
+});
diff --git a/services/auth/src/db/passwordResets.ts b/services/auth/src/db/passwordResets.ts
new file mode 100644
--- /dev/null
+++ b/services/auth/src/db/passwordResets.ts
@@ -0,0 +1,21 @@
+export interface PasswordReset {
+  userId: string;
+  token: string;
+  createdAt: Date;
+}
+
+export const passwordResets = {
+  async insert(reset: PasswordReset) {
+    return pool.query("INSERT INTO password_resets (user_id, token, created_at) VALUES ($1, $2, $3)", [reset.userId, reset.token, reset.createdAt]);
+  },
+  async findByToken(token: string) {
+    const { rows } = await pool.query("SELECT * FROM password_resets WHERE token = $1", [token]);
+    return rows[0];
+  },
+};
diff --git a/services/auth/src/app.ts b/services/auth/src/app.ts
--- a/services/auth/src/app.ts
+++ b/services/auth/src/app.ts
@@ -12,6 +12,7 @@ app.use(express.json());
 app.use("/session", sessionRouter);
 app.use("/users", usersRouter);
+app.use("/auth", passwordResetRouter);
 app.use(errorHandler);
`;

export const fixtureAgents: AgentDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    role: "Plans the review: splits the PR into focus areas for downstream reviewers.",
    systemInstructions:
      "You plan code reviews. Given a pull request, list the changed files, group them into focus areas, and write one short note per reviewer describing what to look at. Respond with JSON matching the output schema. Do not review the code yourself.",
    model: "claude-opus-5-5",
    modelSettings: { maxTokens: 2048 },
    tools: [],
    outputSchema: {
      type: "object",
      required: ["files", "focusAreas", "reviewerNotes"],
      properties: {
        files: { type: "array", items: { type: "string" } },
        focusAreas: { type: "array", items: { type: "string" } },
        reviewerNotes: { type: "object", additionalProperties: { type: "string" } },
      },
    },
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Reviews correctness, error handling and maintainability of the change.",
    systemInstructions:
      "You are a senior TypeScript reviewer. Review the diff for correctness, error handling, data-layer usage and maintainability. Only report issues you can point to in the diff. For each finding give file, line, severity (high/medium/low), the problem and a concrete fix. Respond with JSON matching the output schema.",
    model: "claude-sonnet-5",
    modelSettings: { maxTokens: 4096 },
    tools: [],
    outputSchema: {
      type: "object",
      required: ["findings"],
      properties: {
        findings: {
          type: "array",
          items: {
            type: "object",
            required: ["file", "line", "severity", "problem", "fix"],
            properties: {
              file: { type: "string" },
              line: { type: "number" },
              severity: { enum: ["high", "medium", "low"] },
              problem: { type: "string" },
              fix: { type: "string" },
            },
          },
        },
      },
    },
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Reviews the change for security issues.",
    systemInstructions: "Look for security issues in the code.",
    model: "claude-haiku-4-5",
    modelSettings: { maxTokens: 1024 },
    tools: [],
  },
  {
    id: "final-validator",
    name: "Final Validator",
    role: "Merges reviewer findings and decides whether the PR can be merged.",
    systemInstructions:
      "You are the final gate for a pull request. Combine the code review and security review findings, drop duplicates, and decide: approve, approve_with_changes or block. Block if any high-severity finding is unresolved. Respond with JSON matching the output schema.",
    model: "claude-sonnet-5",
    modelSettings: { maxTokens: 2048 },
    tools: [],
    outputSchema: {
      type: "object",
      required: ["verdict", "blockingIssues", "summary"],
      properties: {
        verdict: { enum: ["approve", "approve_with_changes", "block"] },
        blockingIssues: { type: "array", items: { type: "string" } },
        summary: { type: "string" },
      },
    },
  },
];

export const fixtureFlow: FlowDefinition = {
  id: FLOW_ID,
  name: "PR review",
  description: "Plan a pull-request review, run code review, then security review, then validate.",
  nodes: [
    { id: "plan", agentId: "planner", dependsOn: [], inputMapping: { task: "$input.task", repository: "$input.repository", diff: "$input.diff" } },
    {
      id: "code-review",
      agentId: "code-reviewer",
      dependsOn: ["plan"],
      inputMapping: { diff: "$input.diff", plan: "plan" },
    },
    {
      id: "security-review",
      agentId: "security-reviewer",
      dependsOn: ["code-review"],
      inputMapping: { diff: "$input.diff", plan: "plan" },
    },
    {
      id: "validate",
      agentId: "final-validator",
      dependsOn: ["code-review", "security-review"],
      inputMapping: {
        task: "$input.task",
        diff: "$input.diff",
        codeFindings: "code-review.findings",
        securityFindings: "security-review.findings",
      },
    },
  ],
};

const planOutput = {
  files: ["services/auth/src/routes/passwordReset.ts", "services/auth/src/db/passwordResets.ts", "services/auth/src/app.ts"],
  focusAreas: ["New password reset endpoints", "Reset token persistence", "Router registration"],
  reviewerNotes: {
    "code-reviewer": "Check error handling in both endpoints and the password_resets queries.",
    "security-reviewer": "Check token generation, storage, expiry and anything that leaks account existence or secrets.",
  },
};

const codeReviewOutput = {
  findings: [
    {
      file: "services/auth/src/routes/passwordReset.ts",
      line: 29,
      severity: "medium",
      problem: "`user` may be undefined if the account was deleted after the reset was requested; `user.passwordHash` will throw.",
      fix: "Return 400 when `findById` returns nothing.",
    },
    {
      file: "services/auth/src/routes/passwordReset.ts",
      line: 31,
      severity: "medium",
      problem: "Reset row is never deleted after a successful confirm, so the same token can be reused.",
      fix: "Delete (or mark used) the reset row in the same transaction as the password update.",
    },
    {
      file: "services/auth/src/db/passwordResets.ts",
      line: 9,
      severity: "low",
      problem: "`pool` is used but not imported in this module.",
      fix: "Import `pool` from ./pool.",
    },
  ],
};

const securityReviewOutput =
  "Overall the code looks reasonable. A few things I noticed: the reset token is written to the logs in the request handler which could let anyone with log access reset passwords, this is pretty serious. Also tokens don't seem to expire, there is no check on createdAt. Returning 404 for unknown emails lets attackers enumerate accounts. You might also want rate limiting on the request endpoint.";

const validatorOutput = {
  verdict: "approve_with_changes",
  blockingIssues: [],
  summary:
    "Two medium issues from code review (possible undefined user on confirm, reusable reset token) and one low (missing import). No security findings were provided. Safe to merge once the medium issues are addressed.",
};

const PLAN_END = 6_800;
const CODE_END = 21_400;
const SECURITY_END = 43_700;
const VALIDATE_END = 52_900;

export const fixtureRun: Run = {
  id: RUN_ID,
  flowId: FLOW_ID,
  status: "completed",
  startedAt: at(0),
  completedAt: at(VALIDATE_END),
  steps: [
    {
      id: "step_plan",
      runId: RUN_ID,
      nodeId: "plan",
      agentId: "planner",
      status: "completed",
      input: { task: TASK, repository: "acme/auth-service", diff: DIFF },
      output: planOutput,
      startedAt: at(0),
      completedAt: at(PLAN_END),
      usage: usage("claude-opus-5-5", 5_200, 420, PLAN_END),
      toolCalls: [],
    },
    {
      id: "step_code_review",
      runId: RUN_ID,
      nodeId: "code-review",
      agentId: "code-reviewer",
      status: "completed",
      input: { diff: DIFF, plan: planOutput },
      output: codeReviewOutput,
      startedAt: at(PLAN_END + 100),
      completedAt: at(CODE_END),
      usage: usage("claude-sonnet-5", 6_100, 1_350, CODE_END - PLAN_END - 100),
      toolCalls: [],
    },
    {
      id: "step_security_review",
      runId: RUN_ID,
      nodeId: "security-review",
      agentId: "security-reviewer",
      status: "completed",
      input: { diff: DIFF, plan: planOutput },
      output: securityReviewOutput,
      startedAt: at(CODE_END + 100),
      completedAt: at(SECURITY_END),
      // Two attempts: the first hit maxTokens and was retried by the runtime.
      usage: usage("claude-haiku-4-5", 11_850, 1_900, SECURITY_END - CODE_END - 100),
      toolCalls: [],
    },
    {
      id: "step_validate",
      runId: RUN_ID,
      nodeId: "validate",
      agentId: "final-validator",
      status: "completed",
      input: { task: TASK, diff: DIFF, codeFindings: codeReviewOutput.findings, securityFindings: null },
      output: validatorOutput,
      startedAt: at(SECURITY_END + 100),
      completedAt: at(VALIDATE_END),
      usage: usage("claude-sonnet-5", 7_400, 610, VALIDATE_END - SECURITY_END - 100),
      toolCalls: [],
    },
  ],
};

fixtureRun.totalUsage = fixtureRun.steps.reduce<Usage>(
  (total, step) => ({
    inputTokens: total.inputTokens + (step.usage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (step.usage?.outputTokens ?? 0),
    estimatedCostUsd: total.estimatedCostUsd + (step.usage?.estimatedCostUsd ?? 0),
    latencyMs: VALIDATE_END,
  }),
  { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 },
);

function stepEvents(step: StepRun, modelCalls: Record<string, unknown>[]): TraceEvent[] {
  const base = { runId: RUN_ID, stepRunId: step.id };
  const start = Date.parse(step.startedAt!) - T0;
  const end = Date.parse(step.completedAt!) - T0;
  return [
    { ...base, id: `${step.id}_node_start`, type: "node_start", timestamp: at(start), data: { nodeId: step.nodeId } },
    { ...base, id: `${step.id}_agent_start`, type: "agent_start", timestamp: at(start + 5), data: { agentId: step.agentId } },
    ...modelCalls.map<TraceEvent>((data, i) => ({
      ...base,
      id: `${step.id}_model_call_${i + 1}`,
      type: "model_call",
      timestamp: at(start + 10 + i * Math.round((end - start) / modelCalls.length)),
      data: { attempt: i + 1, ...data },
    })),
    { ...base, id: `${step.id}_agent_end`, type: "agent_end", timestamp: at(end - 5), data: { status: step.status } },
    { ...base, id: `${step.id}_node_end`, type: "node_end", timestamp: at(end), data: { nodeId: step.nodeId } },
  ];
}

const [planStep, codeStep, securityStep, validateStep] = fixtureRun.steps;

export const fixtureEvents: TraceEvent[] = [
  { id: "flow_start", runId: RUN_ID, type: "flow_start", timestamp: at(0), data: { flowId: FLOW_ID } },
  ...stepEvents(planStep, [{ model: "claude-opus-5-5", outcome: "ok" }]),
  ...stepEvents(codeStep, [{ model: "claude-sonnet-5", outcome: "ok" }]),
  ...stepEvents(securityStep, [
    { model: "claude-haiku-4-5", outcome: "error", error: "Response truncated at maxTokens=1024; retrying" },
    { model: "claude-haiku-4-5", outcome: "ok" },
  ]),
  ...stepEvents(validateStep, [{ model: "claude-sonnet-5", outcome: "ok" }]),
  { id: "flow_end", runId: RUN_ID, type: "flow_end", timestamp: at(VALIDATE_END), data: { status: "completed" } },
];

export const codeReviewFixture: EvaluationInput = {
  run: fixtureRun,
  flow: fixtureFlow,
  agents: fixtureAgents,
  events: fixtureEvents,
};
