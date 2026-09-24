import type { AgentResult, AgentRuntime } from "@agentlab/contracts";

export interface MockRuntimeOptions {
  /** Simulated latency range per agent call, in ms. Defaults to 400-1200. */
  minLatencyMs?: number;
  maxLatencyMs?: number;
  /** Agent ids that should fail, to exercise error handling. */
  failAgentIds?: string[];
}

// Available in every JS host, but not part of the ES2022 lib typings.
const { setTimeout } = globalThis as unknown as { setTimeout: (fn: () => void, ms: number) => unknown };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Fake `AgentRuntime` that sleeps and returns a canned output describing what
 * it received. Lets the flow engine and UI be built without real model calls.
 */
export function createMockRuntime(options: MockRuntimeOptions = {}): AgentRuntime {
  const min = options.minLatencyMs ?? 400;
  const max = Math.max(min, options.maxLatencyMs ?? 1200);
  const failing = new Set(options.failAgentIds ?? []);

  return {
    async run(agent, input, context): Promise<AgentResult> {
      const latencyMs = Math.round(min + Math.random() * (max - min));
      await sleep(latencyMs);

      const inputTokens = JSON.stringify(input ?? null).length;
      const outputTokens = 50 + Math.round(Math.random() * 150);
      const usage = {
        inputTokens,
        outputTokens,
        estimatedCostUsd: Number(((inputTokens + outputTokens) * 0.000002).toFixed(6)),
        latencyMs,
      };

      if (failing.has(agent.id)) {
        return {
          agentId: agent.id,
          status: "failed",
          output: undefined,
          error: `Mock failure for ${agent.name}`,
          usage,
          toolCalls: [],
        };
      }

      return {
        agentId: agent.id,
        status: "completed",
        output: {
          agent: agent.name,
          summary: `${agent.name} processed input from ${
            Object.keys(context.priorOutputs ?? {}).join(", ") || "flow input"
          }`,
          receivedInput: input,
        },
        usage,
        toolCalls: [],
      };
    },
  };
}
