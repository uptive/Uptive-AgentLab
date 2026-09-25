/** A placeholder value that fits a JSON Schema: examples/defaults first, then an empty value per type. */
export function sampleFromSchema(schema: unknown, depth = 0): unknown {
  if (typeof schema !== "object" || schema === null || depth > 6) return null;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.examples) && s.examples.length > 0) return s.examples[0];
  if ("default" in s) return s.default;
  if ("const" in s) return s.const;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  const variants = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(variants) && variants.length > 0) return sampleFromSchema(variants[0], depth + 1);
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  if (type === "object" || (type === undefined && typeof s.properties === "object")) {
    const properties = (s.properties ?? {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, sampleFromSchema(value, depth + 1)]));
  }
  if (type === "array") return [sampleFromSchema(s.items, depth + 1)];
  if (type === "string") return typeof s.description === "string" ? `<${s.description}>` : "";
  if (type === "number" || type === "integer") return 0;
  if (type === "boolean") return false;
  return null;
}
