// Node-only entry (`@agentlab/optimization/models`): picks the model backend for LLM-backed evaluators.
//   AGENT_BACKEND=cli (default)  local Claude Code CLI, billed to the logged-in Claude.ai subscription
//   AGENT_BACKEND=api            Anthropic API via the SDK, billed per token (needs ANTHROPIC_API_KEY)
// Each request can name its model; otherwise AGENT_MODEL, then Sonnet 5.
import type { ModelClient } from "../types.js";
import { createAnthropicModelClient } from "./anthropic.js";
import { createClaudeCliModelClient } from "./claudeCli.js";

export type AgentBackend = "cli" | "api";

export function createModelClient(backend: string = process.env.AGENT_BACKEND ?? "cli"): ModelClient {
  switch (backend) {
    case "cli":
      return createClaudeCliModelClient();
    case "api":
      return createAnthropicModelClient();
    default:
      throw new Error(`Unknown AGENT_BACKEND "${backend}". Use "cli" or "api".`);
  }
}

export { ClaudeCliError, createClaudeCliModelClient, parseCliOutput } from "./claudeCli.js";
export { createAnthropicModelClient } from "./anthropic.js";
