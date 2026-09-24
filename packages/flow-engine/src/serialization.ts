import type { FlowDefinition, FlowNode } from "@agentlab/contracts";

export class FlowParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowParseError";
  }
}

/** Serializes a flow to pretty JSON with a stable key order. */
export function serializeFlow(flow: FlowDefinition): string {
  const clean: FlowDefinition = {
    id: flow.id,
    name: flow.name,
    ...(flow.description ? { description: flow.description } : {}),
    nodes: flow.nodes.map((n) => ({
      id: n.id,
      agentId: n.agentId,
      ...(n.label ? { label: n.label } : {}),
      dependsOn: [...n.dependsOn],
      ...(n.inputMapping && Object.keys(n.inputMapping).length > 0 ? { inputMapping: { ...n.inputMapping } } : {}),
      ...(n.position ? { position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } } : {}),
    })),
  };
  return JSON.stringify(clean, null, 2) + "\n";
}

/**
 * Parses and structurally checks a flow JSON document.
 * Graph-level rules (cycles, missing deps) are checked by `validateFlow`.
 */
export function parseFlow(json: string): FlowDefinition {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new FlowParseError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseFlowShape(raw);
}

/** Structurally checks an already-deserialized value (e.g. an IPC payload, not JSON text). */
export function parseFlowShape(raw: unknown): FlowDefinition {
  if (!isObject(raw)) throw new FlowParseError("Flow must be a JSON object");
  const id = requireString(raw, "id", "flow");
  const name = requireString(raw, "name", "flow");
  if (raw.description !== undefined && typeof raw.description !== "string") {
    throw new FlowParseError(`flow.description must be a string`);
  }
  if (!Array.isArray(raw.nodes)) throw new FlowParseError("flow.nodes must be an array");

  const nodes = raw.nodes.map((n, i): FlowNode => {
    const where = `nodes[${i}]`;
    if (!isObject(n)) throw new FlowParseError(`${where} must be an object`);
    const node: FlowNode = {
      id: requireString(n, "id", where),
      agentId: requireString(n, "agentId", where),
      dependsOn: [],
    };
    if (n.dependsOn !== undefined) {
      if (!Array.isArray(n.dependsOn) || !n.dependsOn.every((d) => typeof d === "string")) {
        throw new FlowParseError(`${where}.dependsOn must be an array of strings`);
      }
      node.dependsOn = [...n.dependsOn];
    }
    if (n.label !== undefined) {
      if (typeof n.label !== "string") throw new FlowParseError(`${where}.label must be a string`);
      node.label = n.label;
    }
    if (n.inputMapping !== undefined) {
      if (!isObject(n.inputMapping) || !Object.values(n.inputMapping).every((v) => typeof v === "string")) {
        throw new FlowParseError(`${where}.inputMapping must be an object of strings`);
      }
      node.inputMapping = { ...(n.inputMapping as Record<string, string>) };
    }
    if (n.position !== undefined) {
      const p = n.position;
      if (!isObject(p) || typeof p.x !== "number" || typeof p.y !== "number") {
        throw new FlowParseError(`${where}.position must be { x: number, y: number }`);
      }
      node.position = { x: p.x, y: p.y };
    }
    return node;
  });

  return { id, name, ...(typeof raw.description === "string" ? { description: raw.description } : {}), nodes };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function requireString(obj: Record<string, unknown>, key: string, where: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) throw new FlowParseError(`${where}.${key} must be a non-empty string`);
  return v;
}
