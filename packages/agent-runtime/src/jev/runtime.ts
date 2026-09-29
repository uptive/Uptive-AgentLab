import { randomUUID } from "node:crypto";
import { TypeSafeClient, type EntryType, type Question, type Questions } from "@typesafe-ai/sdk";
import { z } from "zod";
import { readSourceFiles } from "./sources.js";
import {
  agentEngine,
  estimateJevCostUsd,
  type AgentDefinition,
  type AgentResult,
  type AgentRunContext,
  type AgentRuntime,
  type JevAgentDefinition,
  type JevQuestion,
  type TraceEvent,
  type Usage,
} from "@agentlab/contracts";

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, latencyMs: 0 };
const JevApiResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), z.unknown()),
  usage: z.object({
    input_tokens: z.number().nonnegative(),
    output_tokens: z.number().nonnegative(),
  }),
});
const JevModelsSchema = z.array(z.object({ name: z.string().min(1) }));

export interface JevRequest {
  state: unknown;
  questions: JevQuestion[];
  model?: string;
}

export interface JevResponse {
  model: string;
  answers: Record<string, unknown>;
  usage: Usage;
}

export interface JevClient {
  models(signal?: AbortSignal): Promise<string[]>;
  evaluate(request: JevRequest, signal?: AbortSignal): Promise<JevResponse>;
}

export interface JevClientConfig {
  apiKey: string;
  baseURL?: string;
  timeoutMs?: number;
  client?: TypeSafeClient;
}

function toQuestions(definitions: JevQuestion[]): Questions {
  return Object.fromEntries(
    definitions.map((question): [string, Question] => {
      if (question.type === "choice") return [question.id, { type: "choice", instructions: question.instructions, criteria: question.criteria }];
      if (question.type === "score") return [question.id, { type: "score", instructions: question.instructions, criteria: question.criteria }];
      return [question.id, { type: "noul", instructions: question.instructions, criteria: question.criteria }];
    }),
  );
}

function jsonState(value: unknown): EntryType {
  if (value === null || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => jsonState(item));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonState(item)]));
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new Error("Jev state must be text, an object, or an array containing JSON-compatible values");
}

export function createJevClient(config: JevClientConfig): JevClient {
  const client =
    config.client ??
    new TypeSafeClient({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: config.timeoutMs,
      logLevel: "off",
    });
  return {
    async models(signal) {
      return JevModelsSchema.parse(await client.models.list({ signal })).map((model) => model.name);
    },
    async evaluate(request, signal) {
      const startedAt = Date.now();
      const result = JevApiResponseSchema.parse(
        await client.systemOne(
          { state: jsonState(request.state), questions: toQuestions(request.questions), model: request.model },
          { signal },
        ),
      );
      const usage: Usage = {
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        estimatedCostUsd: estimateJevCostUsd({ inputTokens: result.usage.input_tokens }),
        latencyMs: Date.now() - startedAt,
      };
      return { model: result.model, answers: result.answers, usage };
    },
  };
}

export interface JevRuntimeConfig {
  client: JevClient;
  /** Run folder that `sources` globs resolve against; without it an agent with sources fails. */
  folder?: string;
  signal?: AbortSignal;
  onEvent?: (event: TraceEvent) => void;
  now?: () => Date;
}

async function buildState(agent: JevAgentDefinition, input: unknown, folder: string | undefined): Promise<unknown> {
  const patterns = agent.sources ?? [];
  if (patterns.length === 0) return input;
  if (!folder) throw new Error(`Agent "${agent.id}" defines sources but this run has no folder`);
  return { input, files: await readSourceFiles(folder, patterns) };
}

export function createJevAgentRuntime(config: JevRuntimeConfig): AgentRuntime {
  const now = config.now ?? (() => new Date());
  return {
    async run(agent: AgentDefinition, input: unknown, context: AgentRunContext): Promise<AgentResult> {
      if (agentEngine(agent) !== "jev") throw new Error(`Agent "${agent.id}" is not a Jev agent`);
      const jevAgent = agent as JevAgentDefinition;
      const startedAt = Date.now();
      const emit = (type: TraceEvent["type"], data: unknown) =>
        config.onEvent?.({
          id: randomUUID(),
          runId: context.runId,
          stepRunId: context.stepRunId,
          type,
          timestamp: now().toISOString(),
          data,
        });
      emit("agent_start", { agentId: agent.id, agentName: agent.name, engine: "jev", model: agent.model, input });
      try {
        const state = await buildState(jevAgent, input, config.folder);
        if (config.signal?.aborted) throw new Error("Run was cancelled");
        const response = await config.client.evaluate({ state, questions: jevAgent.questions, model: agent.model }, config.signal);
        emit("model_call", {
          provider: "typesafe",
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
          costUsd: response.usage.estimatedCostUsd,
          answers: response.answers,
        });
        const output = { model: response.model, answers: response.answers };
        emit("agent_end", { agentId: agent.id, status: "completed", engine: "jev", usage: response.usage, output });
        return { agentId: agent.id, status: "completed", output, usage: response.usage, toolCalls: [] };
      } catch (error) {
        const usage = { ...ZERO_USAGE, latencyMs: Date.now() - startedAt };
        const message = config.signal?.aborted ? "Run was cancelled" : error instanceof Error ? error.message : String(error);
        emit("agent_end", { agentId: agent.id, status: "failed", engine: "jev", error: message, usage });
        return { agentId: agent.id, status: "failed", output: undefined, error: message, usage, toolCalls: [] };
      }
    },
  };
}

export function createRoutingAgentRuntime(runtimes: { claude: AgentRuntime; jev: AgentRuntime }): AgentRuntime {
  return {
    run(agent, input, context) {
      return runtimes[agentEngine(agent)].run(agent, input, context);
    },
  };
}
