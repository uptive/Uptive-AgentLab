// Runs the model-backed evaluators through the real local Claude Code CLI (your Claude.ai
// subscription). Skipped unless asked for, since it uses real usage:
//   CLAUDE_CLI_LIVE=1 pnpm --filter @agentlab/optimization test llmEvaluators.live
import { describe, expect, it } from "vitest";
import { analyzeRun } from "../analyzeRun.js";
import { createClaudeCliModelClient } from "../clients/claudeCli.js";
import { codeReviewFixture } from "../fixtures/codeReviewRun.js";
import { createModelSelectionLlmEvaluator } from "./modelSelectionLlm.js";
import { createQualityLlmEvaluator } from "./qualityLlm.js";

describe.skipIf(!process.env.CLAUDE_CLI_LIVE)("model-backed evaluators via the Claude Code CLI (live)", () => {
  it("produce valid recommendations for the fixture run", async () => {
    const client = createClaudeCliModelClient();
    const result = await analyzeRun(codeReviewFixture, [createQualityLlmEvaluator(client), createModelSelectionLlmEvaluator(client)]);

    for (const r of result.recommendations) {
      console.log(`\n[${r.category}] ${r.severity} · ${r.title} → ${r.target.kind === "node" ? r.target.nodeId : r.target.kind}`);
      console.log(`  problem:  ${r.problem}`);
      console.log(`  change:   ${r.change.type} ${r.change.path}: ${JSON.stringify(r.change.before)?.slice(0, 80)} → ${JSON.stringify(r.change.after)?.slice(0, 120)}`);
      console.log(`  impact:   ${r.estimatedImpact.summary}`);
    }

    // The model calls themselves must succeed; a fallback here would mean the CLI path failed.
    expect(result.fallbackEvaluators).toEqual([]);
    expect(result.skippedEvaluators).toEqual([]);

    const nodeIds = new Set(codeReviewFixture.flow.nodes.map((n) => n.id));
    for (const r of result.recommendations) {
      expect(["quality", "model-selection"]).toContain(r.category);
      expect(r.title && r.problem && r.suggestion && r.estimatedImpact.summary).toBeTruthy();
      expect(r.target.kind === "node" && nodeIds.has(r.target.nodeId)).toBe(true);
    }

    const ids = result.recommendations.map((r) => r.id);
    expect(ids).toContain("quality:broken-handoff:validate:securityFindings");
    // Planner runs Opus 5.5 for a small planning step; the model should suggest a cheaper one.
    expect(ids).toContain("model-selection:overpowered:plan");
  }, 600_000);
});
