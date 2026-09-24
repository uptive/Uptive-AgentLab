import type { AgentDefinition, AgentInput, AgentStore } from "@agentlab/contracts";

const REQUIRED_FIELDS = ["name", "role", "systemInstructions", "model"] as const;

/** Throws if a required field is missing or blank. Pass `partial` for updates. */
export function validateAgentInput(input: Partial<AgentInput>, partial = false): void {
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if ((!partial || field in input) && (typeof value !== "string" || value.trim() === "")) {
      throw new Error(`Agent field "${field}" is required`);
    }
  }
}

export function createMemoryAgentStore(): AgentStore {
  const agents = new Map<string, AgentDefinition>();

  return {
    async list() {
      return Array.from(agents.values());
    },
    async get(id) {
      return agents.get(id);
    },
    async create(input) {
      validateAgentInput(input);
      const now = new Date().toISOString();
      const agent: AgentDefinition = { ...input, tools: input.tools ?? [], id: crypto.randomUUID(), createdAt: now, updatedAt: now };
      agents.set(agent.id, agent);
      return agent;
    },
    async update(id, patch) {
      validateAgentInput(patch, true);
      const existing = agents.get(id);
      if (!existing) throw new Error(`Agent ${id} not found`);
      const agent: AgentDefinition = { ...existing, ...patch, id, updatedAt: new Date().toISOString() };
      agents.set(id, agent);
      return agent;
    },
    async delete(id) {
      return agents.delete(id);
    },
  };
}
