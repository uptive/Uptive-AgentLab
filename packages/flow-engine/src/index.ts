import { createFlowEngine } from "./executor.js";
import { dummyAgentRegistry } from "./mock/agents.js";
import { createMockRuntime } from "./mock/runtime.js";

export * from "./graph.js";
export * from "./executor.js";
export * from "./serialization.js";
export * from "./demo.js";
export * from "./mock/agents.js";
export * from "./mock/runtime.js";

/** Default engine wired to dummy agents and a mock runtime until real ones exist. */
export const engine = createFlowEngine({
  runtime: createMockRuntime(),
  resolveAgent: dummyAgentRegistry.get,
});
