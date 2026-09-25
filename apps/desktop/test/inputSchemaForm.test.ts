import { describe, expect, it } from "vitest";
import type { AgentDefinition, FlowDefinition } from "@agentlab/contracts";
import {
  buildInputForm,
  collectInput,
  firstAgent,
  formValuesFromInput,
  humanizeKey,
  singularLabel,
  type InputField,
} from "../src/runs/inputSchemaForm.js";

const schema = {
  type: "object",
  required: ["topic", "maxDepth"],
  properties: {
    topic: { type: "string", title: "Research topic", description: "What to research" },
    maxDepth: { type: "integer", default: 2, minimum: 1, maximum: 5 },
    budget_usd: { type: ["number", "null"] },
    verbose: { type: "boolean" },
    tone: { type: "string", enum: ["formal", "casual"] },
    dueAt: { type: "string", format: "date-time" },
    startDate: { type: "string", format: "date" },
    searchQueries: { type: "array", items: { type: "string" } },
    channels: { type: "array", items: { enum: ["email", "slack"] } },
    sources: {
      type: "array",
      items: { type: "object", required: ["url"], properties: { url: { type: "string", format: "uri" }, weight: { type: "number" } } },
    },
    owner: { type: "object", required: ["name"], properties: { name: { type: "string" }, notify: { type: "boolean" } } },
    extra: { anyOf: [{ type: "string" }, { type: "number" }] },
  },
};

function spec() {
  const form = buildInputForm(schema);
  if (!form) throw new Error("expected a form");
  return form;
}

function field(key: string): InputField {
  const found = spec().fields.find((candidate) => candidate.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
}

describe("humanizeKey", () => {
  it.each([
    ["maxDepth", "Max depth"],
    ["budget_usd", "Budget usd"],
    ["user_id", "User ID"],
    ["imageURLs", "Image URLs"],
    ["sourceIds", "Source IDs"],
    ["step2Input", "Step 2 input"],
    ["HTTPStatus", "HTTP status"],
    ["search-queries", "Search queries"],
  ])("%s -> %s", (key, label) => expect(humanizeKey(key)).toBe(label));
});

describe("buildInputForm", () => {
  it("maps every schema shape to a field kind", () => {
    expect(spec().fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["topic", "text", true],
      ["maxDepth", "number", true],
      ["budget_usd", "number", false],
      ["verbose", "boolean", false],
      ["tone", "enum", false],
      ["dueAt", "date", false],
      ["startDate", "date", false],
      ["searchQueries", "array", false],
      ["channels", "multiselect", false],
      ["sources", "array", false],
      ["owner", "object", false],
      ["extra", "json", false],
    ]);
  });

  it("uses a textarea only for long text", () => {
    const form = buildInputForm({
      type: "object",
      properties: { name: { type: "string" }, reviewNotes: { type: "string" }, bio: { type: "string", maxLength: 1000 }, code: { type: "string", maxLength: 10 } },
    });
    expect(form?.fields.map((f) => f.kind === "text" && f.multiline)).toEqual([false, true, true, false]);
  });

  it("prefers the schema title and keeps the description", () => {
    expect(field("topic")).toMatchObject({ label: "Research topic", description: "What to research" });
    expect(field("maxDepth").label).toBe("Max depth");
  });

  it("nests object fields and array items", () => {
    const sources = field("sources");
    if (sources.kind !== "array" || sources.item.kind !== "object") throw new Error("expected an array of objects");
    expect(sources.item.fields.map((f) => [f.key, f.kind, f.required])).toEqual([
      ["url", "text", true],
      ["weight", "number", false],
    ]);
    const owner = field("owner");
    expect(owner.kind === "object" && owner.fields.map((f) => f.label)).toEqual(["Name", "Notify"]);
  });

  it("starts from schema defaults", () => {
    expect(spec().initialValues).toMatchObject({ maxDepth: "2", searchQueries: [], sources: [], owner: { name: "", notify: false } });
  });

  it("returns undefined for schemas that aren't objects with properties", () => {
    expect(buildInputForm(undefined)).toBeUndefined();
    expect(buildInputForm({ type: "object" })).toBeUndefined();
    expect(buildInputForm({ type: "string" })).toBeUndefined();
  });
});

describe("singularLabel", () => {
  const list = (key: string) => {
    const found = buildInputForm({ type: "object", properties: { [key]: { type: "array", items: { type: "string" } } } })?.fields[0];
    if (found?.kind !== "array") throw new Error("expected an array");
    return found;
  };
  it.each([
    ["searchQueries", "search query"],
    ["tags", "tag"],
    ["addresses", "address"],
    ["imageURLs", "image URL"],
    ["status", "status"],
  ])("%s -> %s", (key, noun) => expect(singularLabel(list(key))).toBe(noun));
});

describe("collectInput", () => {
  const { fields, initialValues } = spec();

  it("builds typed input, leaving out untouched optional fields", () => {
    const result = collectInput(fields, {
      ...initialValues,
      topic: "Golf",
      maxDepth: "3",
      dueAt: "2026-10-01T09:30",
      startDate: "2026-10-01",
      searchQueries: ["swing", "putting"],
      channels: ["slack"],
      sources: [{ url: "https://example.com", weight: "0.5" }],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        topic: "Golf",
        maxDepth: 3,
        verbose: false,
        dueAt: new Date("2026-10-01T09:30").toISOString(),
        startDate: "2026-10-01",
        searchQueries: ["swing", "putting"],
        channels: ["slack"],
        sources: [{ url: "https://example.com", weight: 0.5 }],
      },
    });
  });

  it("reports errors by path, including inside lists and filled-in objects", () => {
    const result = collectInput(fields, {
      ...initialValues,
      maxDepth: "9",
      searchQueries: ["ok", ""],
      sources: [{ url: "", weight: "x" }],
      owner: { name: "", notify: true },
      extra: "{",
    });
    expect(result).toEqual({
      ok: false,
      errors: {
        topic: "Required.",
        maxDepth: "Must be at most 5.",
        "searchQueries.1": "Fill this in or remove it.",
        "sources.0.url": "Required.",
        "sources.0.weight": "Must be a number.",
        "owner.name": "Required.",
        extra: "Must be valid JSON.",
      },
    });
  });

  it("round-trips input through the form values", () => {
    const input = {
      topic: "Golf",
      maxDepth: 4,
      verbose: true,
      tone: "casual",
      searchQueries: ["a"],
      channels: ["email"],
      sources: [{ url: "https://x.dev", weight: 1 }],
      owner: { name: "Ada", notify: false },
      extra: 7,
    };
    expect(collectInput(fields, formValuesFromInput(fields, input))).toEqual({ ok: true, value: input });
  });
});

describe("firstAgent", () => {
  const agent = (id: string): AgentDefinition => ({ id, name: id, role: "writer", systemInstructions: "", model: "test-model", tools: [] });
  const agents = new Map([["plan", agent("plan")], ["write", agent("write")]]);

  it("picks the agent of the first node without dependencies", () => {
    const flow: FlowDefinition = {
      id: "f",
      name: "f",
      nodes: [
        { id: "w", agentId: "write", dependsOn: ["p"] },
        { id: "p", agentId: "plan", dependsOn: [] },
      ],
    };
    expect(firstAgent(flow, (id) => agents.get(id))?.id).toBe("plan");
  });
});
