// Calls the real Claude API. Skipped unless credentials are set:
//   ANTHROPIC_API_KEY=... pnpm --filter @agentlab/optimization test flowDesign.live
import { describe, expect, it } from "vitest";
import { createAnthropicModelClient } from "../clients/anthropic.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import { createFlowDesignEvaluator } from "./flowDesign.js";

const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

describe.skipIf(!hasCredentials)("Flow Design evaluator (live Claude API)", () => {
  it("flags that Security Reviewer could run in parallel with Code Reviewer", async () => {
    const recs = await createFlowDesignEvaluator(createAnthropicModelClient()).evaluate(codeReviewFixture);
    console.log(recs.map((r) => `${r.id} | ${r.title} | ${r.estimatedImpact.summary}`).join("\n"));

    const parallel = recs.find((r) => r.id === "flow-design:parallelization:security-review");
    expect(parallel).toBeDefined();
    expect(parallel!.change.after).toEqual(["plan"]);
    expect(parallel!.estimatedImpact.speed!.latencyMs).toBeLessThan(0);
  }, 180_000);
});
