import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentDefinition, TraceEvent } from "@agentlab/contracts";
import { createJevAgentRuntime, createRoutingAgentRuntime, type JevClient } from "../src/jev/runtime.js";
import { MAX_SOURCE_FILES, MAX_SOURCE_FILE_BYTES, MAX_SOURCE_TOTAL_BYTES } from "../src/jev/sources.js";
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
    let started: () => void;
    const evaluating = new Promise<void>((resolve) => {
      started = resolve;
    });
    const runtime = createJevAgentRuntime({
      signal: controller.signal,
      client: {
        models: client.models,
        evaluate: async (_request, signal) =>
          new Promise((_resolve, reject) => {
            started();
            signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          }),
      },
    });

    const pending = runtime.run(agent, "ticket", { runId: "run-1", stepRunId: "step-1" });
    await evaluating;
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

describe("Jev repository sources", () => {
  async function folderWith(files: Record<string, string | Buffer>): Promise<string> {
    const folder = await mkdtemp(path.join(tmpdir(), "jev-sources-"));
    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(folder, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, contents);
    }
    return folder;
  }

  function recordingClient(): { client: JevClient; states: unknown[] } {
    const states: unknown[] = [];
    return {
      states,
      client: {
        models: client.models,
        evaluate: async (request) => {
          states.push(request.state);
          return client.evaluate(request);
        },
      },
    };
  }

  const withSources = (sources: string[]): AgentDefinition => ({ ...agent, sources });

  it("resolves globs and injects file contents into the state", async () => {
    const folder = await folderWith({
      "docs/engine-rules.md": "# Rules",
      "docs/nested/deep.md": "deep",
      ".squad/ownership.yaml": "owner: squad-a",
      "src/index.ts": "export {};",
      ".git/config": "[core]",
    });
    const { client: recorder, states } = recordingClient();
    const runtime = createJevAgentRuntime({ client: recorder, folder });

    const result = await runtime.run(withSources(["docs/**/*.md", ".squad/*.yaml"]), { ticket: "T-1" }, { runId: "r", stepRunId: "s" });

    expect(result.status).toBe("completed");
    expect(states[0]).toEqual({
      input: { ticket: "T-1" },
      files: { ".squad/ownership.yaml": "owner: squad-a", "docs/engine-rules.md": "# Rules", "docs/nested/deep.md": "deep" },
    });
  });

  it("passes the input through untouched when no sources are configured", async () => {
    const { client: recorder, states } = recordingClient();
    const runtime = createJevAgentRuntime({ client: recorder, folder: await folderWith({ "a.md": "a" }) });

    await runtime.run(agent, { ticket: "T-2" }, { runId: "r", stepRunId: "s" });

    expect(states[0]).toEqual({ ticket: "T-2" });
  });

  it("treats a pattern that matches nothing as no files", async () => {
    const { client: recorder, states } = recordingClient();
    const runtime = createJevAgentRuntime({ client: recorder, folder: await folderWith({ "a.md": "a" }) });

    await runtime.run(withSources(["missing/**/*.yaml"]), "ticket", { runId: "r", stepRunId: "s" });

    expect(states[0]).toEqual({ input: "ticket", files: {} });
  });

  it("rejects patterns that escape the run folder", async () => {
    const runtime = createJevAgentRuntime({ client, folder: await folderWith({ "a.md": "a" }) });

    await expect(runtime.run(withSources(["../outside/**"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: 'Jev source pattern "../outside/**" must not contain ".."',
    });
    await expect(runtime.run(withSources(["/etc/passwd"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: 'Jev source pattern "/etc/passwd" must be relative to the run folder',
    });
  });

  it("rejects a symlink pointing outside the run folder", async () => {
    const outside = await folderWith({ "secret.md": "secret" });
    const folder = await folderWith({ "a.md": "a" });
    await symlink(path.join(outside, "secret.md"), path.join(folder, "leak.md"));
    const runtime = createJevAgentRuntime({ client, folder });

    await expect(runtime.run(withSources(["*.md"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: 'Jev source "leak.md" resolves outside the run folder',
    });
  });

  it("fails when a run has no folder", async () => {
    const runtime = createJevAgentRuntime({ client });

    await expect(runtime.run(withSources(["docs/*.md"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: 'Agent "triage" defines sources but this run has no folder',
    });
  });

  it("skips binary files", async () => {
    const folder = await folderWith({ "notes.md": "text", "image.bin": Buffer.from([0, 1, 2, 3]) });
    const { client: recorder, states } = recordingClient();
    const runtime = createJevAgentRuntime({ client: recorder, folder });

    await runtime.run(withSources(["*"]), "t", { runId: "r", stepRunId: "s" });

    expect(states[0]).toEqual({ input: "t", files: { "notes.md": "text" } });
  });

  it("fails rather than truncating a file over the per-file cap", async () => {
    const folder = await folderWith({ "big.md": "x".repeat(MAX_SOURCE_FILE_BYTES + 1) });
    const runtime = createJevAgentRuntime({ client, folder });

    await expect(runtime.run(withSources(["big.md"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: `Jev source "big.md" is ${MAX_SOURCE_FILE_BYTES + 1} bytes, over the ${MAX_SOURCE_FILE_BYTES} byte limit for a single file`,
    });
  });

  it("fails when the files exceed the total byte cap", async () => {
    const chunk = "x".repeat(MAX_SOURCE_FILE_BYTES);
    const count = Math.ceil(MAX_SOURCE_TOTAL_BYTES / MAX_SOURCE_FILE_BYTES) + 1;
    const files = Object.fromEntries(Array.from({ length: count }, (_, index) => [`part-${index}.md`, chunk]));
    const runtime = createJevAgentRuntime({ client, folder: await folderWith(files) });

    await expect(runtime.run(withSources(["*.md"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: `Jev sources exceed the ${MAX_SOURCE_TOTAL_BYTES} byte total limit; narrow the patterns`,
    });
  });

  it("fails when the patterns match more files than the cap allows", async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_SOURCE_FILES + 1 }, (_, index) => [`note-${index}.md`, "x"]));
    const runtime = createJevAgentRuntime({ client, folder: await folderWith(files) });

    await expect(runtime.run(withSources(["*.md"]), "t", { runId: "r", stepRunId: "s" })).resolves.toMatchObject({
      status: "failed",
      error: `Jev sources match more than ${MAX_SOURCE_FILES} files; narrow the patterns`,
    });
  });

  it("rejects invalid source patterns when saving an agent", async () => {
    const store = createMemoryAgentStore();
    const { id: _id, ...input } = agent;

    await expect(store.create({ ...input, sources: ["docs/**/*.md"] })).resolves.toMatchObject({ sources: ["docs/**/*.md"] });
    await expect(store.create({ ...input, sources: ["../secrets"] })).rejects.toThrow('must not contain ".."');
    await expect(store.create({ ...input, sources: [" "] })).rejects.toThrow("Jev source pattern must not be empty");
  });
});
