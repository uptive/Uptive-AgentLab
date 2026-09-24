import { describe, expect, it } from "vitest";
import { FlowParseError, parseFlow, serializeFlow } from "../src/index.js";
import { codeReviewFlow } from "./fixtures/codeReviewFlow.js";

describe("serialization", () => {
  it("round-trips a flow", () => {
    expect(parseFlow(serializeFlow(codeReviewFlow))).toEqual(codeReviewFlow);
  });

  it("round-trips tags and normalizes them", () => {
    const flow = { ...codeReviewFlow, tags: [" Review ", "security", "review", "", "code  quality"] };
    const parsed = parseFlow(serializeFlow(flow));
    expect(parsed.tags).toEqual(["Review", "security", "code quality"]);
    expect(parseFlow(serializeFlow(parsed))).toEqual(parsed);
  });

  it("omits empty tag lists", () => {
    expect(serializeFlow({ ...codeReviewFlow, tags: [" "] })).not.toContain("tags");
    expect(parseFlow('{"id":"f","name":"F","tags":[],"nodes":[]}')).not.toHaveProperty("tags");
  });

  it("defaults missing dependsOn to []", () => {
    expect(parseFlow('{"id":"f","name":"F","nodes":[{"id":"a","agentId":"planner"}]}').nodes[0].dependsOn).toEqual([]);
  });

  it("rejects malformed documents", () => {
    expect(() => parseFlow("{")).toThrow(FlowParseError);
    expect(() => parseFlow("[]")).toThrow(/JSON object/);
    expect(() => parseFlow('{"id":"f","name":"F"}')).toThrow(/nodes must be an array/);
    expect(() => parseFlow('{"id":"f","name":"F","tags":"x","nodes":[]}')).toThrow(/tags/);
    expect(() => parseFlow('{"id":"f","name":"F","tags":[1],"nodes":[]}')).toThrow(/tags/);
    expect(() => parseFlow('{"id":"f","name":"F","nodes":[{"id":"a"}]}')).toThrow(/agentId/);
    expect(() => parseFlow('{"id":"f","name":"F","nodes":[{"id":"a","agentId":"x","position":{"x":1}}]}')).toThrow(/position/);
  });
});
