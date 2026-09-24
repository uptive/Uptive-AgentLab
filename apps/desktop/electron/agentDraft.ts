import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import type { AgentDraft, AgentDraftRequest } from "./api.js";

const DRAFT_MODEL = "claude-opus-5-5";
const TIMEOUT_MS = 180_000;

const SYSTEM_PROMPT = `You design AI agent definitions for AgentLab, where agents are chained into flows.
The user describes what they want the agent to achieve. Map that into a complete agent definition:
- name: short, human-friendly (2-4 words).
- description: one sentence shown on the agent card, saying what the agent does.
- role: a short lowercase category label (1-2 words) for the agent's job in a flow, e.g. "reviewer". Reuse one of
  the existing roles listed in the request whenever one fits; only invent a new label when none does.
- systemInstructions: the full system prompt the agent runs with. Be specific and thorough: goal, step-by-step
  approach, constraints, edge cases, and the exact output format. This is the most important field.
- model: pick from the allowed list; stronger models for complex reasoning, faster ones for simple transforms.
- temperature: 0-1; low for deterministic/extraction work, higher for creative work.
- maxTokens: a sensible output budget for one response.
- tools: tools the agent would need (e.g. web_search, fetch_url, read_file). Use kind "mcp" for external MCP
  servers and "function" for local functions. Empty list if none are needed.
- inputSchema / outputSchema: JSON Schemas describing what the agent receives from the previous step and what it
  returns to the next one.
Write in the same language as the user's description.`;

function draftSchema(models: string[]) {
  return {
    type: "object",
    properties: {
      name: { type: "string" },
      description: { type: "string" },
      role: { type: "string" },
      systemInstructions: { type: "string" },
      model: { type: "string", enum: models },
      temperature: { type: "number", minimum: 0, maximum: 1 },
      maxTokens: { type: "integer", minimum: 1 },
      tools: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string" }, kind: { type: "string", enum: ["mcp", "function"] } },
          required: ["name", "kind"],
        },
      },
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    },
    required: [
      "name",
      "description",
      "role",
      "systemInstructions",
      "model",
      "temperature",
      "maxTokens",
      "tools",
      "inputSchema",
      "outputSchema",
    ],
  };
}

/** Runs the `claude` CLI headless and returns an agent definition mapped from a free-text description. */
/** `roles` are the existing role names; the draft reuses one when it fits. */
export function generateAgentDraft({ description, models }: AgentDraftRequest, roles: string[]): Promise<AgentDraft> {
  if (!description.trim()) return Promise.reject(new Error("Describe what the agent should achieve first."));

  // Isolated run: no tools, MCP servers, settings, skills or sessions, so only our prompt goes to the model.
  const args = [
    "-p",
    "--model", DRAFT_MODEL,
    "--output-format", "json",
    "--json-schema", JSON.stringify(draftSchema(models)),
    "--system-prompt", SYSTEM_PROMPT,
    "--tools", "",
    "--strict-mcp-config",
    "--setting-sources", "",
    "--disable-slash-commands",
    "--no-session-persistence",
  ];

  return new Promise((resolve, reject) => {
    const child = execFile(
      process.env.CLAUDE_BIN || "claude",
      args,
      { cwd: tmpdir(), timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const reason =
            (error as NodeJS.ErrnoException).code === "ENOENT"
              ? "claude CLI not found. Install Claude Code or set CLAUDE_BIN in .env."
              : error.killed
                ? `claude CLI timed out after ${TIMEOUT_MS / 1000}s.`
                : stderr.trim() || stdout.trim() || error.message;
          reject(new Error(reason));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          if (result.is_error || !result.structured_output) {
            throw new Error(typeof result.result === "string" && result.result ? result.result : "No structured output returned.");
          }
          resolve(result.structured_output as AgentDraft);
        } catch (e) {
          reject(new Error(`Could not read claude CLI output: ${(e as Error).message}`));
        }
      },
    );
    const existingRoles = roles.length ? roles.join(", ") : "(none yet)";
    child.stdin?.end(`Existing roles: ${existingRoles}\n\nWhat the agent should achieve:\n${description}`);
  });
}
