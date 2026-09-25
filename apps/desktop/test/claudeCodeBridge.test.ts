import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { AgentDefinition, FlowDefinition, Run } from "@agentlab/contracts";
import { createMemoryTelemetryStore, type AsyncTelemetryStore } from "@agentlab/observability";
import type { StartRunRequest } from "../electron/api.js";
import { startClaudeCodeBridge, type ClaudeCodeBridge } from "../electron/claudeCodeBridge.js";

const TOKEN = "t".repeat(40);

const flow: FlowDefinition = {
  id: "review",
  name: "Review",
  nodes: [
    { id: "read", agentId: "reader", dependsOn: [] },
    { id: "write", agentId: "writer", dependsOn: ["read"], label: "Write up" },
  ],
};

const agent = (id: string): AgentDefinition => ({
  id,
  name: `Agent ${id}`,
  role: "tester",
  systemInstructions: "",
  model: "claude-haiku-4-5-20251001",
  tools: [],
  inputSchema: { type: "object", properties: { topic: { type: "string" } } },
});

function finishedRun(runId: string, request: StartRunRequest): Run {
  return {
    id: runId,
    flowId: request.flow.id,
    status: "completed",
    startedAt: "2026-09-25T10:00:00.000Z",
    completedAt: "2026-09-25T10:01:00.000Z",
    flow: request.flow,
    startedBy: request.startedBy,
    steps: request.flow.nodes.map((n) => ({ id: `s-${n.id}`, runId, nodeId: n.id, agentId: n.agentId, status: "completed", input: null, output: `done ${n.id}`, toolCalls: [] })),
  };
}

describe("Claude Code bridge", () => {
  let bridge: ClaudeCodeBridge;
  let telemetry: AsyncTelemetryStore;
  let started: StartRunRequest[];
  let cancelled: string[];
  let finish: () => Promise<void>;

  beforeEach(async () => {
    telemetry = createMemoryTelemetryStore();
    started = [];
    cancelled = [];
    bridge = await startClaudeCodeBridge(
      {
        listFlows: async () => ({ flows: [{ id: flow.id, name: flow.name, source: "database", nodeCount: 2 }], errors: [] }),
        getFlow: async (id) => (id === flow.id ? flow : undefined),
        listAgents: async () => ({ agents: [{ id: "reader", name: "Agent reader", role: "tester", model: "claude-haiku-4-5-20251001" }], errors: [] }),
        getAgent: async (id) => (id === "missing" ? undefined : agent(id)),
        telemetry,
        runs: {
          recovered: Promise.resolve(),
          cancelRun: async (runId) => void cancelled.push(runId),
          startRun: async (request) => {
            started.push(request);
            const runId = `run-${started.length}`;
            await telemetry.saveRun({ ...finishedRun(runId, request), status: "running", completedAt: undefined });
            let resolveDone: (run: Run) => void = () => {};
            const done = new Promise<Run>((r) => (resolveDone = r));
            finish = async () => {
              const run = finishedRun(runId, request);
              await telemetry.saveRun(run);
              resolveDone(run);
            };
            return { runId, done };
          },
        },
      },
      { port: 0, token: TOKEN },
    );
  });

  afterEach(() => bridge.close());

  async function connect(token = TOKEN) {
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(bridge.url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    return client;
  }

  const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const [first] = result.content as { type: string; text: string }[];
    return { isError: Boolean(result.isError), text: first.text, data: result.isError ? undefined : JSON.parse(first.text) };
  };

  it("refuses a wrong token, browser origins and other paths", async () => {
    await expect(connect("x".repeat(40))).rejects.toThrow();
    const withOrigin = await fetch(bridge.url, { method: "POST", headers: { Authorization: `Bearer ${TOKEN}`, Origin: "https://evil.example" } });
    expect(withOrigin.status).toBe(403);
    const otherPath = await fetch(bridge.url.replace("/mcp", "/other"), { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(otherPath.status).toBe(404);
  });

  it("refuses to start with a short token", async () => {
    await expect(startClaudeCodeBridge({} as never, { port: 0, token: "short" })).rejects.toThrow(/at least/);
  });

  it("lists flows and describes a flow with its input schema", async () => {
    const client = await connect();
    expect((await call(client, "list_flows")).data.flows).toEqual([{ id: "review", name: "Review", source: "database", nodeCount: 2 }]);
    const described = (await call(client, "get_flow", { flowId: "review" })).data;
    expect(described.steps.map((s: { nodeId: string; agentName: string }) => [s.nodeId, s.agentName])).toEqual([
      ["read", "Agent reader"],
      ["write", "Agent writer"],
    ]);
    expect(described.inputSchema).toEqual(agent("reader").inputSchema);
    await client.close();
  });

  it("starts a saved flow as claude-code and waits for the result", async () => {
    const client = await connect();
    const start = await call(client, "start_run", { flowId: "review", input: { topic: "golf" } });
    expect(start.data.runId).toBe("run-1");
    expect(started[0]).toMatchObject({ flow, input: { topic: "golf" }, startedBy: "claude-code" });

    const waiting = call(client, "get_run", { runId: "run-1", waitSeconds: 30 });
    await finish();
    const run = (await waiting).data;
    expect(run.status).toBe("completed");
    expect(run.startedBy).toBe("claude-code");
    expect(run.steps[1]).toMatchObject({ nodeId: "write", label: "Write up", status: "completed", output: "done write" });
    await client.close();
  });

  it("reports unknown flows and runs as tool errors", async () => {
    const client = await connect();
    expect(await call(client, "start_run", { flowId: "nope" })).toMatchObject({ isError: true });
    expect(started).toHaveLength(0);
    expect(await call(client, "get_run", { runId: "nope" })).toMatchObject({ isError: true });
    await client.close();
  });

  it("lists agents and describes one with its input schema", async () => {
    const client = await connect();
    expect((await call(client, "list_agents")).data.agents.map((a: { id: string }) => a.id)).toEqual(["reader"]);
    const described = (await call(client, "get_agent", { agentId: "reader" })).data;
    expect(described).toMatchObject({ id: "reader", name: "Agent reader", inputSchema: agent("reader").inputSchema });
    expect(await call(client, "get_agent", { agentId: "missing" })).toMatchObject({ isError: true });
    await client.close();
  });

  it("runs a single saved agent as a one-step flow", async () => {
    const client = await connect();
    const start = await call(client, "start_agent_run", { agentId: "reader", input: { topic: "putting" } });
    expect(start.data).toMatchObject({ runId: "run-1", flow: "Agent reader" });
    expect(started[0]).toMatchObject({
      flow: { id: "agent:reader", nodes: [{ id: "reader", agentId: "reader", dependsOn: [] }] },
      input: { topic: "putting" },
      startedBy: "claude-code",
    });

    const waiting = call(client, "get_run", { runId: "run-1", waitSeconds: 30 });
    await finish();
    expect((await waiting).data.steps).toEqual([expect.objectContaining({ agent: "reader", status: "completed", output: "done reader" })]);
    await client.close();
  });

  it("refuses to run an unknown agent", async () => {
    const client = await connect();
    expect(await call(client, "start_agent_run", { agentId: "missing" })).toMatchObject({ isError: true });
    expect(started).toHaveLength(0);
    await client.close();
  });

  it("cancels runs", async () => {
    const client = await connect();
    await call(client, "cancel_run", { runId: "run-9" });
    expect(cancelled).toEqual(["run-9"]);
    await client.close();
  });
});
