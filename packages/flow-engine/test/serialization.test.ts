import { describe, expect, it } from "vitest";
import { FlowParseError, parseFlow, serializeFlow } from "../src/index.js";
import { codeReviewFlow } from "./fixtures/codeReviewFlow.js";

describe("serialization", () => {
  it("round-trips a flow", () => {
    expect(parseFlow(serializeFlow(codeReviewFlow))).toEqual(codeReviewFlow);
  });

  it("defaults missing dependsOn to []", () => {
    expect(parseFlow('{"id":"f","name":"F","nodes":[{"id":"a","agentId":"planner"}]}').nodes[0].dependsOn).toEqual([]);
  });

  it("rejects malformed documents", () => {
    expect(() => parseFlow("{")).toThrow(FlowParseError);
    expect(() => parseFlow("[]")).toThrow(/JSON object/);
    expect(() => parseFlow('{"id":"f","name":"F"}')).toThrow(/nodes must be an array/);
    expect(() => parseFlow('{"id":"f","name":"F","nodes":[{"id":"a"}]}')).toThrow(/agentId/);
    expect(() => parseFlow('{"id":"f","name":"F","nodes":[{"id":"a","agentId":"x","position":{"x":1}}]}')).toThrow(/position/);
  });
});
