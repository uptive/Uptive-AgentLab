import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  FlowDefinition,
  FlowNode,
  Run,
  StepRun,
  TraceEvent,
  TraceEventType,
  Usage,
} from "@agentlab/contracts";
import { assertValidFlow, getDependents } from "./graph.js";

export interface FlowEngineConfig {
  runtime: AgentRuntime;
  /** Resolves an agent definition by id (e.g. from an agent registry). */
  resolveAgent: (agentId: string) => AgentDefinition | undefined;
  /** Max nodes running at the same time. Defaults to unlimited. */
  maxConcurrency?: number;
  /** Receives flow/node trace events (e.g. forward to a TelemetryStore). */
  onEvent?: (event: TraceEvent) => void;
  /** Id generator, injectable for deterministic tests. */
  generateId?: () => string;
  /** Clock, injectable for deterministic tests. */
  now?: () => Date;
}

export interface ExecuteOptions {
  /** Called with a snapshot of the run whenever any step changes state. */
  onRunUpdate?: (run: Run) => void;
  /** Aborting stops scheduling new nodes; running nodes are allowed to finish. */
  signal?: { readonly aborted: boolean }; // structurally compatible with AbortSignal
}

export interface FlowEngine {
  execute(flow: FlowDefinition, input: unknown, options?: ExecuteOptions): Promise<Run>;
}

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };

// The engine targets plain ES2022 (renderer, Node, workers), so reach these via globalThis.
const env = globalThis as {
  structuredClone?: <T>(value: T) => T;
  crypto?: { randomUUID?: () => string };
};
const clone = <T>(value: T): T => (env.structuredClone ? env.structuredClone(value) : JSON.parse(JSON.stringify(value)));
let idCounter = 0;
const defaultId = () => env.crypto?.randomUUID?.() ?? `id-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

/**
 * Creates a DAG-based flow engine.
 *
 * Scheduling: a node becomes ready once all of its `dependsOn` nodes have
 * completed. Every ready node is started immediately (subject to
 * `maxConcurrency`), which gives sequential execution for chains, parallel
 * execution for fan-out, and join semantics for fan-in.
 *
 * Input passing (when the node has no `inputMapping`):
 *   - no dependencies  -> the flow input
 *   - one dependency   -> that node's output
 *   - many (join)      -> `{ [depNodeId]: output }`
 * `context.priorOutputs` always contains `{ [depNodeId]: output }`.
 *
 * Failure: when a node fails, its downstream nodes are never started and stay
 * `pending`; independent branches continue. The run ends as `failed`.
 */
export function createFlowEngine(config: FlowEngineConfig): FlowEngine {
  const generateId = config.generateId ?? defaultId;
  const now = config.now ?? (() => new Date());
  const maxConcurrency = Math.max(1, config.maxConcurrency ?? Number.POSITIVE_INFINITY);

  return {
    async execute(flow, input, options = {}) {
      assertValidFlow(flow);

      const nodesById = new Map(flow.nodes.map((n) => [n.id, n]));
      const dependents = getDependents(flow);
      const runStart = now();

      const run: Run = {
        id: generateId(),
        flowId: flow.id,
        status: "running",
        startedAt: runStart.toISOString(),
        steps: [],
      };
      const stepsByNode = new Map<string, StepRun>();
      for (const node of flow.nodes) {
        const step: StepRun = {
          id: generateId(),
          runId: run.id,
          nodeId: node.id,
          agentId: node.agentId,
          status: "pending",
          input: undefined,
          toolCalls: [],
        };
        stepsByNode.set(node.id, step);
        run.steps.push(step);
      }

      const emit = (type: TraceEventType, data: unknown, stepRunId?: string) => {
        config.onEvent?.({ id: generateId(), runId: run.id, stepRunId, type, timestamp: now().toISOString(), data });
      };
      const publish = () => options.onRunUpdate?.(clone(run));

      emit("flow_start", { flowId: flow.id, input });
      publish();

      const outputs = new Map<string, unknown>();
      const remainingDeps = new Map(flow.nodes.map((n) => [n.id, new Set(n.dependsOn)]));
      const ready: string[] = flow.nodes.filter((n) => n.dependsOn.length === 0).map((n) => n.id);
      let running = 0;

      await new Promise<void>((resolveAll) => {
        const pump = () => {
          while (ready.length > 0 && running < maxConcurrency && !options.signal?.aborted) {
            const nodeId = ready.shift()!;
            running++;
            void runNode(nodesById.get(nodeId)!).finally(() => {
              running--;
              pump();
            });
          }
          if (running === 0) resolveAll();
        };

        const runNode = async (node: FlowNode) => {
          const step = stepsByNode.get(node.id)!;
          const priorOutputs = Object.fromEntries(node.dependsOn.map((d) => [d, outputs.get(d)]));
          step.input = buildNodeInput(node, input, priorOutputs);
          step.status = "running";
          step.startedAt = now().toISOString();
          emit("node_start", { nodeId: node.id, agentId: node.agentId }, step.id);
          publish();

          let result: AgentResult;
          try {
            const agent = config.resolveAgent(node.agentId);
            if (!agent) throw new Error(`Unknown agent "${node.agentId}"`);
            result = await config.runtime.run(agent, step.input, {
              runId: run.id,
              stepRunId: step.id,
              priorOutputs,
            });
          } catch (err) {
            result = {
              agentId: node.agentId,
              status: "failed",
              output: undefined,
              error: err instanceof Error ? err.message : String(err),
              usage: { ...ZERO_USAGE },
              toolCalls: [],
            };
          }

          step.status = result.status;
          step.output = result.output;
          step.error = result.error;
          step.usage = result.usage;
          step.toolCalls = result.toolCalls;
          step.completedAt = now().toISOString();
          emit("node_end", { nodeId: node.id, status: result.status, error: result.error }, step.id);

          if (result.status === "completed") {
            outputs.set(node.id, result.output);
            for (const child of dependents.get(node.id) ?? []) {
              const deps = remainingDeps.get(child)!;
              deps.delete(node.id);
              if (deps.size === 0) ready.push(child);
            }
          }
          publish();
        };

        pump();
      });

      const failed = run.steps.some((s) => s.status === "failed");
      const incomplete = run.steps.some((s) => s.status !== "completed");
      run.status = failed || incomplete ? "failed" : "completed";
      const runEnd = now();
      run.completedAt = runEnd.toISOString();
      run.totalUsage = sumUsage(run.steps, runEnd.getTime() - runStart.getTime());

      emit("flow_end", { flowId: flow.id, status: run.status, aborted: options.signal?.aborted ?? false });
      publish();
      return clone(run);
    },
  };
}

export function buildNodeInput(node: FlowNode, flowInput: unknown, priorOutputs: Record<string, unknown>): unknown {
  if (node.inputMapping) {
    return Object.fromEntries(
      Object.entries(node.inputMapping).map(([key, ref]) => {
        const [root, ...path] = ref.split(".");
        const base = root === "$input" ? flowInput : priorOutputs[root];
        return [key, getPath(base, path)];
      }),
    );
  }
  if (node.dependsOn.length === 0) return flowInput;
  if (node.dependsOn.length === 1) return priorOutputs[node.dependsOn[0]];
  return priorOutputs;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function sumUsage(steps: StepRun[], wallClockMs: number): Usage {
  const total = steps.reduce<Usage>(
    (acc, s) => ({
      inputTokens: acc.inputTokens + (s.usage?.inputTokens ?? 0),
      outputTokens: acc.outputTokens + (s.usage?.outputTokens ?? 0),
      estimatedCostUsd: acc.estimatedCostUsd + (s.usage?.estimatedCostUsd ?? 0),
      latencyMs: 0,
    }),
    { ...ZERO_USAGE },
  );
  // Parallel branches overlap, so the run's latency is wall-clock time, not a sum.
  return { ...total, latencyMs: wallClockMs };
}
