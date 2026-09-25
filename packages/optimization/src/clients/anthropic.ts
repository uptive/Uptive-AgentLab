// Node-only (Electron main, scripts, tests): imports the Anthropic SDK. Never import this from the
// renderer; it is exposed separately as `@agentlab/optimization/anthropic`.
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_EVALUATOR_MODEL } from "../evaluatorModels.js";
import { estimateCostUsd, getModel } from "../modelCatalog.js";
import type { JsonRequest, JsonResponse, ModelClient } from "../types.js";

export function createAnthropicModelClient(options: { model?: string } = {}): ModelClient {
  let client: Anthropic | undefined;

  const self: ModelClient = {
    async generateJson(request) {
      return (await self.generateJsonWithUsage!(request)).value;
    },
    async generateJsonWithUsage({ system, prompt, schema, model = options.model ?? process.env.AGENT_MODEL ?? DEFAULT_EVALUATOR_MODEL }: JsonRequest): Promise<JsonResponse> {
      const started = Date.now();
      try {
        // Resolves credentials from ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / `ant auth login` profile.
        client ??= new Anthropic();
      } catch (error) {
        throw new Error(`No Claude API credentials (set ANTHROPIC_API_KEY): ${error instanceof Error ? error.message : error}`);
      }

      let response;
      try {
        // Server-side refusal fallbacks are only offered for the Opus/Fable tier.
        const withFallbacks = /^claude-(opus-5|fable)/.test(model);
        response = await client.beta.messages.create({
          model,
          max_tokens: 16000,
          ...(withFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
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
      const tokens = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
      const info = getModel(model);
      return {
        value: JSON.parse(text),
        usage: { model, ...tokens, costUsd: info ? estimateCostUsd(info, tokens) : undefined, durationMs: Date.now() - started },
      };
    },
  };
  return self;
}
