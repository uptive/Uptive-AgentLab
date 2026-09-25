import { createServer, type IncomingMessage, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { singleAgentFlow, type AgentDefinition, type FlowDefinition, type Run } from "@agentlab/contracts";
import type { AsyncTelemetryStore } from "@agentlab/observability";
import type { AgentRuns } from "./agentRuns.js";

// A local MCP server so Claude Code can list flows and agents and start runs. Runs go through the
// same startRun as the Run button, so they show up live in the Runs view and are saved like any other.
// It only listens on loopback, needs a bearer token, and only runs flows and agents that are already
// saved: callers pick one by id and never send flow or agent definitions. A single agent runs as a
// one-step flow, the same way the Runs view starts one.

export type FlowSource = "database" | "file";

export interface BridgeFlowSummary {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  source: FlowSource;
  nodeCount: number;
}

export interface BridgeAgentSummary {
  id: string;
  name: string;
  description?: string;
  role: string;
  model: string;
}

export interface ClaudeCodeBridgeDeps {
  /** Saved flows from MongoDB and registered flow files; sources that fail are left out and reported. */
  listFlows(): Promise<{ flows: BridgeFlowSummary[]; errors: string[] }>;
  getFlow(id: string, source: FlowSource): Promise<FlowDefinition | undefined>;
  /** Saved agents from the local folder and MongoDB; sources that fail are left out and reported. */
  listAgents(): Promise<{ agents: BridgeAgentSummary[]; errors: string[] }>;
  getAgent(id: string): Promise<AgentDefinition | undefined>;
  runs: AgentRuns;
  telemetry: AsyncTelemetryStore;
}

export interface ClaudeCodeBridgeOptions {
  /** 0 picks a free port. */
  port: number;
  token: string;
}

export interface ClaudeCodeBridge {
  url: string;
  close(): Promise<void>;
}

/** Tokens shorter than this are refused, so a placeholder value never opens the bridge. */
export const MIN_TOKEN_LENGTH = 32;
const MAX_WAIT_SECONDS = 600;
/** Step outputs are cut to this many characters so one large result doesn't flood Claude's context. */
const MAX_OUTPUT_CHARS = 20_000;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function startClaudeCodeBridge(deps: ClaudeCodeBridgeDeps, options: ClaudeCodeBridgeOptions): Promise<ClaudeCodeBridge> {
  if (options.token.length < MIN_TOKEN_LENGTH) {
    return Promise.reject(new Error(`The bridge token must be at least ${MIN_TOKEN_LENGTH} characters`));
  }
  const expected = Buffer.from(`Bearer ${options.token}`);
  // Runs started through the bridge, so get_run can wait for them to finish.
  const pending = new Map<string, Promise<Run>>();

  const server = createServer((req, res) => {
    const rejection = rejectReason(req, expected);
    if (rejection) {
      res.writeHead(rejection.status, { "content-type": "text/plain" }).end(rejection.message);
      return;
    }
    // Stateless: a fresh MCP server and transport per request, closed when the response ends.
    const mcp = createMcpServer(deps, pending);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    mcp
      .connect(transport)
      .then(() => transport.handleRequest(req, res))
      .catch((error: unknown) => {
        console.error("[claude-code] request failed:", error);
        if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }).end("Internal error");
      });
  });

  return listen(server, options.port).then((port) => ({
    url: `http://127.0.0.1:${port}/mcp`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  }));
}

/** Resolves with the port actually bound (differs from `port` when it is 0). */
function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : port);
    });
  });
}

/** Why a request is refused, or undefined when it may go through. */
function rejectReason(req: IncomingMessage, expected: Buffer): { status: number; message: string } | undefined {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/mcp") return { status: 404, message: "Not found" };
  // Browsers always send Origin on cross-site requests; Claude Code never does. Together with the
  // Host check this keeps web pages (including DNS-rebinding ones) from reaching the bridge.
  if (req.headers.origin) return { status: 403, message: "Browser requests are not allowed" };
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!LOOPBACK_HOSTS.has(host)) return { status: 403, message: "Host not allowed" };
  const auth = Buffer.from(req.headers.authorization ?? "");
  if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) return { status: 401, message: "Unauthorized" };
  return undefined;
}

const sourceSchema = z.enum(["database", "file"]);

function createMcpServer(deps: ClaudeCodeBridgeDeps, pending: Map<string, Promise<Run>>): McpServer {
  const mcp = new McpServer({ name: "agentlab", version: "0.0.1" });

  /** Starts a run as claude-code and remembers it, so get_run can wait for it. */
  async function start(flow: FlowDefinition, input: unknown, folder: string | undefined): Promise<CallToolResult> {
    try {
      const { runId, done } = await deps.runs.startRun({ flow, input, folder, startedBy: "claude-code" });
      pending.set(runId, done);
      void done.finally(() => pending.delete(runId));
      return json({ runId, flow: flow.name, status: "running", hint: "Watch it live in AgentLab under Runs, or call get_run." });
    } catch (error) {
      return failure((error as Error).message);
    }
  }

  mcp.registerTool(
    "list_flows",
    {
      description: "Lists the flows saved in AgentLab (MongoDB and registered flow files). Use the id and source with get_flow and start_run.",
      inputSchema: {},
    },
    async () => {
      const { flows, errors } = await deps.listFlows();
      return json({ flows, ...(errors.length ? { unavailableSources: errors } : {}) });
    },
  );

  mcp.registerTool(
    "get_flow",
    {
      description:
        "Shows a flow's steps (agent, dependencies) and the input it expects: the first agent's input schema. Read this before start_run to build the input.",
      inputSchema: { flowId: z.string().min(1), source: sourceSchema.optional() },
    },
    async ({ flowId, source }) => {
      const found = await findFlow(deps, flowId, source);
      if ("error" in found) return failure(found.error);
      const { flow } = found;
      const agents = new Map<string, AgentDefinition | undefined>();
      for (const id of new Set(flow.nodes.map((n) => n.agentId))) agents.set(id, await deps.getAgent(id).catch(() => undefined));
      const entry = flow.nodes.find((n) => n.dependsOn.length === 0);
      return json({
        id: flow.id,
        name: flow.name,
        description: flow.description,
        source: found.source,
        steps: flow.nodes.map((n) => ({
          nodeId: n.id,
          label: n.label,
          agentId: n.agentId,
          agentName: agents.get(n.agentId)?.name ?? "(missing agent)",
          agentDescription: agents.get(n.agentId)?.description,
          dependsOn: n.dependsOn,
        })),
        inputSchema: entry ? agents.get(entry.agentId)?.inputSchema : undefined,
      });
    },
  );

  mcp.registerTool(
    "start_run",
    {
      description:
        "Starts a saved flow in AgentLab and returns its run id right away. The run shows up live in the app's Runs view. Use get_run with waitSeconds to wait for the result.",
      inputSchema: {
        flowId: z.string().min(1),
        source: sourceSchema.optional().describe("Needed only when a flow file and a database flow share the id"),
        input: z.unknown().optional().describe("The flow input: a string, or an object matching the flow's input schema"),
        folder: z.string().min(1).optional().describe("Absolute path of a folder the agents may read, e.g. a repository"),
      },
    },
    async ({ flowId, source, input, folder }) => {
      const found = await findFlow(deps, flowId, source);
      if ("error" in found) return failure(found.error);
      return start(found.flow, input, folder);
    },
  );

  mcp.registerTool(
    "list_agents",
    {
      description: "Lists the agents saved in AgentLab (local folder and MongoDB). Use the id with get_agent and start_agent_run.",
      inputSchema: {},
    },
    async () => {
      const { agents, errors } = await deps.listAgents();
      return json({ agents, ...(errors.length ? { unavailableSources: errors } : {}) });
    },
  );

  mcp.registerTool(
    "get_agent",
    {
      description: "Shows an agent's role, model, tools and the input it expects. Read this before start_agent_run to build the input.",
      inputSchema: { agentId: z.string().min(1) },
    },
    async ({ agentId }) => {
      const agent = await deps.getAgent(agentId);
      if (!agent) return failure(`No agent with id "${agentId}". Call list_agents to see the saved agents.`);
      return json({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        role: agent.role,
        model: agent.model,
        tools: agent.tools,
        skills: agent.skills,
        inputSchema: agent.inputSchema,
        outputSchema: agent.outputSchema,
      });
    },
  );

  mcp.registerTool(
    "start_agent_run",
    {
      description:
        "Runs one saved agent on its own and returns the run id right away. The run shows up live in the app's Runs view. Use get_run with waitSeconds to wait for the result.",
      inputSchema: {
        agentId: z.string().min(1),
        input: z.unknown().optional().describe("The agent input: a string, or an object matching the agent's input schema"),
        folder: z.string().min(1).optional().describe("Absolute path of a folder the agent may read, e.g. a repository"),
      },
    },
    async ({ agentId, input, folder }) => {
      const agent = await deps.getAgent(agentId);
      if (!agent) return failure(`No agent with id "${agentId}". Call list_agents to see the saved agents.`);
      return start(singleAgentFlow(agent), input, folder);
    },
  );

  mcp.registerTool(
    "get_run",
    {
      description:
        "Returns a run's status and each step's status, output or error. With waitSeconds, waits up to that long for a running run to finish first.",
      inputSchema: { runId: z.string().min(1), waitSeconds: z.number().int().min(0).max(MAX_WAIT_SECONDS).optional() },
    },
    async ({ runId, waitSeconds }, extra) => {
      const done = pending.get(runId);
      if (done && waitSeconds) await waitFor(done, waitSeconds * 1000, extra.signal);
      const run = await deps.telemetry.getRun(runId);
      return run ? json(summarizeRun(run)) : failure(`No run with id ${runId}`);
    },
  );

  mcp.registerTool(
    "cancel_run",
    {
      description: "Stops a running run. Steps already running finish; nothing new starts.",
      inputSchema: { runId: z.string().min(1) },
    },
    async ({ runId }) => {
      await deps.runs.cancelRun(runId);
      return json({ runId, cancelled: true });
    },
  );

  mcp.registerTool(
    "list_runs",
    {
      description: "Lists the most recent runs on this computer, newest first.",
      inputSchema: { limit: z.number().int().min(1).max(50).optional() },
    },
    async ({ limit }) => {
      const runs = await deps.telemetry.listRuns();
      runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      return json({
        runs: runs.slice(0, limit ?? 10).map((r) => ({
          runId: r.id,
          flow: r.flow?.name ?? r.flowId,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          startedBy: r.startedBy,
        })),
      });
    },
  );

  return mcp;
}

type FoundFlow = { flow: FlowDefinition; source: FlowSource } | { error: string };

async function findFlow(deps: ClaudeCodeBridgeDeps, flowId: string, source?: FlowSource): Promise<FoundFlow> {
  if (source) {
    const flow = await deps.getFlow(flowId, source);
    return flow ? { flow, source } : { error: `No ${source} flow with id "${flowId}"` };
  }
  const matches = (await deps.listFlows()).flows.filter((f) => f.id === flowId);
  if (matches.length === 0) return { error: `No flow with id "${flowId}". Call list_flows to see the saved flows.` };
  if (matches.length > 1) return { error: `Both a database flow and a flow file have id "${flowId}"; pass source.` };
  const flow = await deps.getFlow(flowId, matches[0].source);
  return flow ? { flow, source: matches[0].source } : { error: `Flow "${flowId}" could not be read` };
}

function summarizeRun(run: Run) {
  const labels = new Map(run.flow?.nodes.map((n) => [n.id, n.label]) ?? []);
  const agentNames = new Map(run.agents?.map((a) => [a.id, a.name]) ?? []);
  return {
    runId: run.id,
    flow: run.flow?.name ?? run.flowId,
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    startedBy: run.startedBy,
    totalUsage: run.totalUsage,
    steps: run.steps.map((s) => ({
      nodeId: s.nodeId,
      label: labels.get(s.nodeId),
      agent: agentNames.get(s.agentId) ?? s.agentId,
      status: s.status,
      ...(s.output !== undefined ? { output: truncate(s.output) } : {}),
      ...(s.error ? { error: s.error } : {}),
    })),
  };
}

function truncate(value: unknown): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined || text.length <= MAX_OUTPUT_CHARS) return value;
  return `${text.slice(0, MAX_OUTPUT_CHARS)}… [cut at ${MAX_OUTPUT_CHARS} characters; the full output is in AgentLab]`;
}

/** Resolves when `done` settles, the timeout passes, or the request is aborted, whichever is first. */
function waitFor(done: Promise<unknown>, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, timeoutMs);
    signal.addEventListener("abort", finish, { once: true });
    void done.then(finish, finish);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
  });
}

const json = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const failure = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });
