import type { FlowDefinition } from "@agentlab/contracts";

/** Planner -> [Code Reviewer || Security Reviewer] -> Final Validator */
export const codeReviewFlow: FlowDefinition = {
  id: "code-review-flow",
  name: "Code Review Flow",
  description: "Plans a review, runs code and security reviews in parallel, then validates.",
  nodes: [
    { id: "plan", agentId: "planner", dependsOn: [], position: { x: 0, y: 120 } },
    { id: "code-review", agentId: "code-reviewer", dependsOn: ["plan"], position: { x: 300, y: 0 } },
    { id: "security-review", agentId: "security-reviewer", dependsOn: ["plan"], position: { x: 300, y: 240 } },
    {
      id: "validate",
      agentId: "final-validator",
      dependsOn: ["code-review", "security-review"],
      position: { x: 600, y: 120 },
    },
  ],
};

export const codeReviewDemoInput = {
  prompt: "Review PR #42. Fokusera på buggar, säkerhetsrisker och regressionsrisker.",
};
