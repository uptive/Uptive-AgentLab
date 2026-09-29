import type { AgentDefinition, AgentInput, AgentStore, JevQuestion } from "@agentlab/contracts";
import { validateSourcePattern } from "./jev/validation.js";

const REQUIRED_FIELDS = ["name", "role", "model"] as const;
const QUESTION_ID = /^[A-Za-z][A-Za-z0-9_-]*$/;

function validateQuestions(questions: unknown): asserts questions is JevQuestion[] {
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('Jev agent field "questions" must contain at least one question');
  const ids = new Set<string>();
  for (const [index, value] of questions.entries()) {
    if (!value || typeof value !== "object") throw new Error(`Jev question ${index + 1} must be an object`);
    const question = value as Record<string, unknown>;
    if (typeof question.id !== "string" || !QUESTION_ID.test(question.id)) {
      throw new Error(`Jev question ${index + 1} id must start with a letter and contain only letters, digits, "_" or "-"`);
    }
    if (ids.has(question.id)) throw new Error(`Jev question id "${question.id}" is duplicated`);
    ids.add(question.id);
    if (typeof question.instructions !== "string" || question.instructions.trim() === "") {
      throw new Error(`Jev question "${question.id}" needs instructions`);
    }
    if (!["choice", "score", "noul"].includes(String(question.type))) {
      throw new Error(`Jev question "${question.id}" has unsupported type "${String(question.type)}"`);
    }
    if (question.type === "choice") {
      if (!question.criteria || typeof question.criteria !== "object" || Array.isArray(question.criteria)) {
        throw new Error(`Jev choice question "${question.id}" needs criteria`);
      }
      const entries = Object.entries(question.criteria);
      if (entries.length < 2 || entries.some(([key, description]) => !key.trim() || (description !== null && typeof description !== "string"))) {
        throw new Error(`Jev choice question "${question.id}" needs at least two named criteria`);
      }
    }
    if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.some((item) => typeof item !== "string"))) {
      throw new Error(`Jev score question "${question.id}" needs at least two rubric levels`);
    }
  }
}

function validateSources(sources: unknown): void {
  if (sources === undefined) return;
  if (!Array.isArray(sources)) throw new Error('Jev agent field "sources" must be a list of glob patterns');
  for (const pattern of sources) {
    if (typeof pattern !== "string" || pattern.trim() === "") throw new Error("Jev source pattern must not be empty");
    validateSourcePattern(pattern);
  }
}

/** Throws if a required field is missing or blank. Pass `partial` for updates. */
export function validateAgentInput(input: Partial<AgentInput>, partial = false): void {
  const fields = input as Record<string, unknown>;
  for (const field of REQUIRED_FIELDS) {
    const value = input[field];
    if ((!partial || field in input) && (typeof value !== "string" || value.trim() === "")) {
      throw new Error(`Agent field "${field}" is required`);
    }
  }
  const engine = "engine" in input && input.engine === "jev" ? "jev" : "claude";
  if (engine === "jev") {
    if (!partial || "questions" in input) validateQuestions(fields.questions);
    validateSources(fields.sources);
    if ("tools" in input || "skills" in input || "systemInstructions" in input || "modelSettings" in input) {
      throw new Error("Jev agents cannot define Claude instructions, tools, skills or model settings");
    }
  } else if ((!partial || "systemInstructions" in input) && (typeof fields.systemInstructions !== "string" || fields.systemInstructions.trim() === "")) {
    throw new Error('Agent field "systemInstructions" is required');
  }
}

export function normalizeAgent(agent: AgentDefinition): AgentDefinition {
  const fields = Object.fromEntries(Object.entries(agent).filter(([, value]) => value !== undefined)) as Record<string, unknown>;
  if (fields.engine === "jev") {
    delete fields.systemInstructions;
    delete fields.modelSettings;
    delete fields.tools;
    delete fields.skills;
    return fields as unknown as AgentDefinition;
  }
  delete fields.questions;
  delete fields.sources;
  return { ...fields, engine: "claude", tools: Array.isArray(fields.tools) ? fields.tools : [] } as unknown as AgentDefinition;
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
      const agent = normalizeAgent({ ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now } as AgentDefinition);
      agents.set(agent.id, agent);
      return agent;
    },
    async update(id, patch) {
      const existing = agents.get(id);
      if (!existing) throw new Error(`Agent ${id} not found`);
      const agent = normalizeAgent({ ...existing, ...patch, id, updatedAt: new Date().toISOString() } as AgentDefinition);
      validateAgentInput(agent);
      agents.set(id, agent);
      return agent;
    },
    async delete(id) {
      return agents.delete(id);
    },
  };
}
