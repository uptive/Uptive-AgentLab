import type { AgentDefinition } from "@agentlab/contracts";

const reviewOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          location: { type: "string" },
          issue: { type: "string" },
          suggestion: { type: "string" },
        },
        required: ["severity", "issue", "suggestion"],
      },
    },
  },
  required: ["summary", "findings"],
};

/**
 * Built-in agents for the workshop's "Review PR #42" scenario. They are always available to flows;
 * agents saved in the app are looked up first. The Planner deliberately uses a strong model so the
 * Optimize view has a model-selection recommendation to make.
 */
export const demoAgents: AgentDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    role: "Breaks the task down into a review plan",
    status: "active",
    systemInstructions:
      "You plan code reviews. Read the pull request (title, description and diff) and produce a short review plan: what the change does, the risky areas, and what the code reviewer and the security reviewer should each focus on.",
    model: "claude-opus-5",
    tools: [],
    outputSchema: {
      type: "object",
      properties: {
        changeSummary: { type: "string" },
        riskAreas: { type: "array", items: { type: "string" } },
        codeReviewFocus: { type: "array", items: { type: "string" } },
        securityReviewFocus: { type: "array", items: { type: "string" } },
      },
      required: ["changeSummary", "riskAreas", "codeReviewFocus", "securityReviewFocus"],
    },
    limits: { maxCostUsd: 1 },
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Reviews code for bugs and regressions",
    status: "active",
    systemInstructions:
      "You review code changes for bugs, regressions and unclear logic, following the plan you are given. If a repository folder is available, read the surrounding code to confirm a finding before reporting it. Report only real problems, most severe first.",
    model: "claude-sonnet-5",
    tools: [
      { id: "Read", name: "Read", kind: "builtin" },
      { id: "Grep", name: "Grep", kind: "builtin" },
      { id: "Glob", name: "Glob", kind: "builtin" },
    ],
    outputSchema: reviewOutputSchema,
    limits: { maxCostUsd: 1 },
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Reviews code for security risks",
    status: "active",
    systemInstructions:
      "You review code changes for security risks such as injection, leaked secrets, missing authorization and unsafe input handling, following the plan you are given. Report only real risks, most severe first.",
    model: "claude-sonnet-5",
    tools: [
      { id: "Read", name: "Read", kind: "builtin" },
      { id: "Grep", name: "Grep", kind: "builtin" },
    ],
    outputSchema: reviewOutputSchema,
    limits: { maxCostUsd: 1 },
  },
  {
    id: "final-validator",
    name: "Final Validator",
    role: "Combines both reviews into a final verdict",
    status: "active",
    systemInstructions:
      "You receive a code review and a security review of the same change. Combine them into one verdict: approve if there are no high-severity findings, otherwise request changes. List the reasons.",
    model: "claude-sonnet-5",
    tools: [],
    outputSchema: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["approve", "request-changes"] },
        reasons: { type: "array", items: { type: "string" } },
      },
      required: ["verdict", "reasons"],
    },
    limits: { maxCostUsd: 0.5 },
  },
];

export function findAgent(id: string, agents: AgentDefinition[] = demoAgents): AgentDefinition | undefined {
  return agents.find((agent) => agent.id === id);
}
