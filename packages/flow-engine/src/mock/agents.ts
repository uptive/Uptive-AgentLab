import type { AgentDefinition } from "@agentlab/contracts";

/**
 * Placeholder agents until the Agent Runtime group provides a real registry.
 * Shapes follow `AgentDefinition` so they can be swapped out transparently.
 */
export const dummyAgents: AgentDefinition[] = [
  {
    id: "planner",
    name: "Planner",
    role: "planner",
    description: "Breaks the task into a plan and assigns focus areas.",
    systemInstructions: "You break a task into concrete steps for downstream reviewers.",
    model: "claude-haiku-4-5",
    tools: [],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    role: "reviewer",
    description: "Looks for bugs and regression risks.",
    systemInstructions: "Review the code for bugs, readability and regression risks.",
    model: "claude-sonnet-5",
    tools: [],
  },
  {
    id: "security-reviewer",
    name: "Security Reviewer",
    role: "reviewer",
    description: "Looks for security vulnerabilities.",
    systemInstructions: "Review the code for security vulnerabilities and unsafe patterns.",
    model: "claude-sonnet-5",
    tools: [],
  },
  {
    id: "researcher",
    name: "Researcher",
    role: "researcher",
    description: "Gathers background context.",
    systemInstructions: "Collect relevant background information for the task.",
    model: "claude-haiku-4-5",
    tools: [],
  },
  {
    id: "summarizer",
    name: "Summarizer",
    role: "writer",
    description: "Condenses inputs into a short summary.",
    systemInstructions: "Summarize the provided material concisely.",
    model: "claude-haiku-4-5",
    tools: [],
  },
  {
    id: "final-validator",
    name: "Final Validator",
    role: "validator",
    description: "Merges all findings and produces a verdict.",
    systemInstructions: "Merge all reviewer findings and produce a final verdict.",
    model: "claude-sonnet-5",
    tools: [],
  },
];

export function createAgentRegistry(agents: AgentDefinition[]) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  return {
    list: () => [...agents],
    get: (id: string) => byId.get(id),
  };
}

export const dummyAgentRegistry = createAgentRegistry(dummyAgents);
