import { describe, expect, it } from "vitest";
import type { AgentDefinition, TraceEvent } from "@agentlab/contracts";
import { createJevAgentRuntime, createRoutingAgentRuntime, type JevClient } from "../src/jev/runtime.js";
import { createMemoryAgentStore } from "../src/agentStore.js";

const agent: AgentDefinition = {
  id: "triage",
  engine: "jev",
  name: "Triage",
  role: "classifier",
  model: "jev-latest",
  questions: [
    {
      id: "department",
      type: "choice",
      instructions: "Which team should handle this?",
      criteria: { billing: "Payment issue", technical: "Product issue" },
    },
  ],
};

const client: JevClient = {
  models: async () => ["jev-latest"],
  evaluate: async () => ({
    model: "jev-1.13.0",
    answers: { department: { type: "choice", choice: "technical", confidence: 0.8, probabilities: { billing: 0.2, technical: 0.8 } } },
    usage: { inputTokens: 120, outputTokens: 20, estimatedCostUsd: 0.00000504, latencyMs: 80 },
  }),
};

describe("createJevAgentRuntime", () => {
  it("returns structured answers and provider trace events", async () => {
    const events: TraceEvent[] = [];
    const runtime = createJevAgentRuntime({ client, onEvent: (event) => events.push(event) });

    const result = await runtime.run(agent, { ticket: "The integration is broken" }, { runId: "run-1", stepRunId: "step-1" });

    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({
      model: "jev-1.13.0",
      answers: { department: { choice: "technical" } },
    });
    expect(result.usage.inputTokens).toBe(120);
    expect(events.map((event) => event.type)).toEqual(["agent_start", "model_call", "agent_end"]);
    expect(events[1].data).toMatchObject({ provider: "typesafe", model: "jev-1.13.0" });
  });

  it("routes agents by engine", async () => {
    const claudeResult = { agentId: "writer", status: "completed" as const, output: "done", usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0, latencyMs: 1 }, toolCalls: [] };
    const router = createRoutingAgentRuntime({
      claude: { run: async () => claudeResult },
      jev: createJevAgentRuntime({ client }),
    });

    expect((await router.run(agent, "ticket", { runId: "r", stepRunId: "s" })).output).toMatchObject({ model: "jev-1.13.0" });
    expect(
      await router.run(
        { id: "writer", engine: "claude", name: "Writer", role: "writer", model: "claude-sonnet-5", systemInstructions: "Write.", tools: [] },
        "input",
        { runId: "r", stepRunId: "s2" },
      ),
    ).toEqual(claudeResult);
  });

  it("reports cancellation when an in-flight request aborts", async () => {
    const controller = new AbortController();
    const runtime = createJevAgentRuntime({
      signal: controller.signal,
      client: {
        models: client.models,
        evaluate: async (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      },
    });

    const pending = runtime.run(agent, "ticket", { runId: "run-1", stepRunId: "step-1" });
    controller.abort();
    await expect(pending).resolves.toMatchObject({ status: "failed", error: "Run was cancelled" });
  });
});

describe("Jev agent validation", () => {
  it("accepts valid Jev agents and rejects duplicate question ids", async () => {
    const store = createMemoryAgentStore();
    const { id: _id, ...input } = agent;
    await expect(store.create(input)).resolves.toMatchObject({ engine: "jev", name: "Triage" });
    await expect(
      store.create({ ...input, questions: [...input.questions, input.questions[0]] }),
    ).rejects.toThrow('Jev question id "department" is duplicated');
  });

  it("removes provider-specific fields when switching engines", async () => {
    const store = createMemoryAgentStore();
    const claude = await store.create({
      engine: "claude",
      name: "Router",
      role: "router",
      model: "claude-sonnet-5",
      systemInstructions: "Route the request.",
      tools: [{ id: "Read", name: "Read", kind: "builtin" }],
    });

    const jev = await store.update(claude.id, {
      engine: "jev",
      model: "jev-latest",
      questions: agent.questions,
    });
    expect(jev).toMatchObject({ engine: "jev", questions: agent.questions });
    expect(jev).not.toHaveProperty("systemInstructions");
    expect(jev).not.toHaveProperty("tools");

    const switchedBack = await store.update(claude.id, {
      engine: "claude",
      model: "claude-sonnet-5",
      systemInstructions: "Route the request.",
      tools: [],
    });
    expect(switchedBack).toMatchObject({ engine: "claude", systemInstructions: "Route the request.", tools: [] });
    expect(switchedBack).not.toHaveProperty("questions");
  });
});
