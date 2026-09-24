import type { AgentDefinition } from "@agentlab/contracts";

/**
 * Demo agents used by the workshop's "Review PR #42" scenario. Group 1 owns the
 * real registry; this is a placeholder so other groups can build against it.
 */
export const demoAgents: AgentDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    role: "Breaks the task down into a review plan",
    systemInstructions: "Read the PR description and produce a short, structured review plan.",
    model: "gpt-4o-mini",
    tools: [],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "Reviews code for bugs and regressions",
    systemInstructions: "Look for bugs, regressions and unclear logic in the diff.",
    model: "gpt-4o",
    tools: [{ id: "read_file", name: "read_file", kind: "function" }],
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "Reviews code for security risks",
    systemInstructions: "Look for security risks such as injection, secrets and unsafe input handling.",
    model: "gpt-4o",
    tools: [{ id: "grep_search", name: "grep_search", kind: "function" }],
  },
  {
    id: "final-validator",
    name: "Final Validator",
    role: "Combines both reviews into a final verdict",
    systemInstructions: "Combine the code and security review into a single pass/fail verdict with reasons.",
    model: "gpt-4o-mini",
    tools: [],
  },
];

export function findAgent(id: string, agents: AgentDefinition[] = demoAgents): AgentDefinition | undefined {
  return agents.find((agent) => agent.id === id);
}
