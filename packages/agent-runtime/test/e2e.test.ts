// Real end-to-end run against Claude: skipped unless AGENTLAB_E2E=1 (`pnpm test:e2e`).
// Uses whatever credentials Claude Code finds: ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN or the local login.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TraceEvent } from "@agentlab/contracts";
import { createFlowEngine, demoFlow } from "@agentlab/flow-engine";
import { createClaudeAgentRuntime } from "../src/claude/runtime.js";
import { createSkillFileStore } from "../src/library.js";
import { createClaudeCodeJsonClient, getClaudeAuthStatus, testMcpServer } from "../src/claude/inspect.js";
import { demoAgents, findAgent } from "../src/demo.js";

const DIFF = `diff --git a/src/users.ts b/src/users.ts
+export async function findUser(db, req) {
+  const name = req.query.name;
+  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
+}`;

describe.skipIf(!process.env.AGENTLAB_E2E)("e2e: real Claude", () => {
  it("runs the code review flow with parallel reviewers", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentlab-e2e-"));
    const events: TraceEvent[] = [];
    const runtime = createClaudeAgentRuntime({
      skillsDir: path.join(root, "skills"),
      workspaceRoot: path.join(root, "workspaces"),
      resolveMcpServer: async () => undefined,
      onEvent: (e) => events.push(e),
    });
    const engine = createFlowEngine({ runtime, resolveAgent: (id) => findAgent(id, demoAgents), onEvent: (e) => events.push(e) });

    const run = await engine.execute(demoFlow, { title: "Add user lookup", description: "Find users by name", diff: DIFF });

    for (const step of run.steps) console.log(step.agentId, step.status, step.error ?? "", JSON.stringify(step.usage));
    console.log("verdict", JSON.stringify(run.steps.find((s) => s.agentId === "final-validator")?.output));
    expect(run.status).toBe("completed");
    expect(run.steps.find((s) => s.agentId === "final-validator")?.output).toMatchObject({ verdict: "request-changes" });
    expect(run.totalUsage?.estimatedCostUsd).toBeGreaterThan(0);
    expect(events.filter((e) => e.type === "model_call").length).toBeGreaterThanOrEqual(4);
  }, 600_000);

  it("loads a skill and calls a function tool", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agentlab-e2e-"));
    const skills = createSkillFileStore(path.join(root, "skills"));
    await skills.save({
      name: "pirate-voice",
      description: "Use this skill whenever you write a greeting or any message to a person.",
      instructions: "Write every greeting in pirate speak and start it with the word 'Ahoy'.",
    });
    const events: TraceEvent[] = [];
    const runtime = createClaudeAgentRuntime({ skillsDir: skills.dir, workspaceRoot: path.join(root, "ws"), resolveMcpServer: async () => undefined, onEvent: (e) => events.push(e) });

    const result = await runtime.run(
      {
        id: "greeter",
        name: "Greeter",
        role: "writer",
        systemInstructions: "You write short greetings. Check your skills before writing.",
        model: "claude-sonnet-5",
        tools: [{ id: "current_time", name: "Current time", kind: "function" }],
        skills: ["pirate-voice"],
      },
      "Write a one-line greeting for Leon that mentions today's date (use the current_time tool).",
      { runId: "e2e", stepRunId: "greeter" },
    );

    const toolNames = events.filter((e) => e.type === "tool_call").map((e) => (e.data as { toolId: string }).toolId);
    console.log(result.status, result.error ?? "", JSON.stringify(result.output), toolNames);
    expect(result.status).toBe("completed");
    expect(toolNames).toContain("mcp__agentlab__current_time");
    expect(toolNames).toContain("Skill");
    expect(String(result.output)).toMatch(/ahoy/i);
  }, 300_000);

  it("reports auth, tests a public MCP server, uses its tools, and returns JSON", async () => {
    const auth = await getClaudeAuthStatus();
    console.log("auth", auth);
    expect(auth.source).not.toBe("unknown");

    const deepwiki = { id: "deepwiki", name: "DeepWiki", transport: { type: "http" as const, url: "https://mcp.deepwiki.com/mcp" } };
    const test = await testMcpServer(deepwiki, undefined);
    console.log("mcp", test.status, test.tools.map((t) => t.name));
    expect(test.status).toBe("connected");
    expect(test.tools.map((t) => t.name)).toContain("read_wiki_structure");

    const root = await mkdtemp(path.join(tmpdir(), "agentlab-e2e-"));
    const events: TraceEvent[] = [];
    const runtime = createClaudeAgentRuntime({
      skillsDir: path.join(root, "skills"),
      workspaceRoot: path.join(root, "ws"),
      resolveMcpServer: async (id) => (id === "deepwiki" ? deepwiki : undefined),
      onEvent: (e) => events.push(e),
    });
    const result = await runtime.run(
      {
        id: "wiki", name: "Wiki", role: "researcher", model: "claude-sonnet-5",
        systemInstructions: "Answer using the DeepWiki tools. Be brief.",
        tools: [{ id: "deepwiki-structure", name: "Wiki structure", kind: "mcp", serverId: "deepwiki", toolName: "read_wiki_structure" }],
      },
      "List three top-level documentation topics of the GitHub repo facebook/react.",
      { runId: "e2e", stepRunId: "wiki" },
    );
    const toolNames = events.filter((e) => e.type === "tool_call").map((e) => (e.data as { toolId: string }).toolId);
    console.log(result.status, result.error ?? "", toolNames);
    expect(result.status).toBe("completed");
    expect(toolNames).toContain("mcp__deepwiki__read_wiki_structure");

    const json = await createClaudeCodeJsonClient({ model: "claude-haiku-4-5" }).generateJson({
      system: "Return the requested JSON.",
      prompt: "Give me the number seven.",
      schema: { type: "object", properties: { n: { type: "number" } }, required: ["n"], additionalProperties: false },
    });
    expect(json).toEqual({ n: 7 });
  }, 300_000);
});
