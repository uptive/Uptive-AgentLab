// Node-only (Electron main, scripts, tests): imports the Anthropic SDK. Never import this from the
// renderer; it is exposed separately as `@agentlab/optimization/anthropic`.
import Anthropic from "@anthropic-ai/sdk";
import type { JsonRequest, ModelClient } from "../types.js";

export const EVALUATOR_MODEL = "claude-opus-5";

export function createAnthropicModelClient(options: { model?: string } = {}): ModelClient {
  let client: Anthropic | undefined;

  return {
    async generateJson({ system, prompt, schema }: JsonRequest) {
      try {
        // Resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
        client ??= new Anthropic();
      } catch (error) {
        throw new Error(`No Claude API credentials (set ANTHROPIC_API_KEY): ${error instanceof Error ? error.message : error}`);
      }

      let response;
      try {
        response = await client.beta.messages.create({
          model: options.model ?? EVALUATOR_MODEL,
          max_tokens: 16000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          thinking: { type: "adaptive" },
          output_config: { effort: "medium", format: { type: "json_schema", schema } },
          system,
          messages: [{ role: "user", content: prompt }],
        });
      } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) throw new Error("Claude API rejected the credentials (check ANTHROPIC_API_KEY)");
        if (error instanceof Anthropic.RateLimitError) throw new Error("Claude API rate limit hit; try again shortly");
        if (error instanceof Error && /authentication method/i.test(error.message)) {
          throw new Error("No Claude API credentials. Set ANTHROPIC_API_KEY before starting the app");
        }
        throw error;
      }

      if (response.stop_reason === "refusal") throw new Error("Claude declined to analyze this run");
      if (response.stop_reason === "max_tokens") throw new Error("Claude's response was cut off before it finished");
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return JSON.parse(text);
    },
  };
}
