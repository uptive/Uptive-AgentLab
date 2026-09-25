import type { AgentDefinition, FlowDefinition } from "@agentlab/contracts";

// Turns the first agent's `inputSchema` (a JSON Schema) into form fields for the Start execution dialog.
// The root must be an object schema; parts the form can't express (anyOf, $ref, ...) become JSON boxes.

/** What the form holds while editing: strings for inputs, booleans for toggles, and nested lists/objects. */
export type FormValue = string | boolean | FormValue[] | FormObject;
export type FormObject = { [key: string]: FormValue };

export type DateFormat = "date-time" | "date" | "time";

interface BaseField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  default?: unknown;
}

export type InputField =
  | (BaseField & { kind: "text"; multiline: boolean })
  | (BaseField & { kind: "number"; integer: boolean; minimum?: number; maximum?: number })
  | (BaseField & { kind: "boolean" })
  | (BaseField & { kind: "enum"; options: (string | number)[] })
  | (BaseField & { kind: "date"; format: DateFormat })
  /** An array of enum values, picked with checkboxes. */
  | (BaseField & { kind: "multiselect"; options: (string | number)[] })
  | (BaseField & { kind: "array"; item: InputField })
  | (BaseField & { kind: "object"; fields: InputField[] })
  /** Anything the form can't express is edited as JSON. */
  | (BaseField & { kind: "json" });

export interface InputFormSpec {
  fields: InputField[];
  initialValues: FormObject;
}

const MAX_DEPTH = 5;

/** Keys that usually hold paragraphs rather than a single line: `prompt`, `reviewNotes`, `body_text`, ... */
const LONG_TEXT_KEY = /(description|prompt|text|content|body|notes?|instructions?|message|summary|details|context)$/i;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFormObject(value: FormValue | undefined): value is FormObject {
  return typeof value === "object" && !Array.isArray(value);
}

export const asText = (value: FormValue | undefined): string => (typeof value === "string" ? value : "");
export const asList = (value: FormValue | undefined): FormValue[] => (Array.isArray(value) ? value : []);
export const asObject = (value: FormValue | undefined): FormObject => (isFormObject(value) ? value : {});

// ---- Labels ------------------------------------------------------------------------------------

const ACRONYMS = new Set(["id", "url", "uri", "api", "json", "html", "http", "https", "llm", "ai", "ui", "sql", "csv", "pdf", "ip", "uuid", "sku"]);

function formatWord(word: string): string {
  if (ACRONYMS.has(word)) return word.toUpperCase();
  // Plural acronyms keep a lowercase "s": "ids" -> "IDs".
  if (word.endsWith("s") && ACRONYMS.has(word.slice(0, -1))) return `${word.slice(0, -1).toUpperCase()}s`;
  return word;
}

/** A readable label for a property key: `maxResults` -> "Max results", `user_id` -> "User ID". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    // Split "HTTPStatus" but not a plural acronym like "URLs".
    .replace(/([A-Z]+)([A-Z][a-rt-z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((word) => formatWord(word.toLowerCase()));
  if (words.length === 0) return key;
  const [first = "", ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

function singularWord(word: string): string {
  if (/[^aeiou]ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/(ss|sh|ch|x|z|us)es$/i.test(word)) return word.slice(0, -2);
  if (/[^su]s$/i.test(word)) return word.slice(0, -1);
  return word;
}

/** What one item of a list is called, for "Add …" and "Remove …": the item's title, or the list's label made singular. */
export function singularLabel(field: Extract<InputField, { kind: "array" }>): string {
  const words = (field.item.label || field.label).split(" ");
  const last = words.pop() ?? "";
  // "Search queries" -> "search query", but acronyms stay upper case: "Image URLs" -> "image URL".
  return [...words, singularWord(last)].map((word) => (word === word.toUpperCase() && word.length > 1 ? word : word.toLowerCase())).join(" ") || "item";
}

// ---- Schema -> fields --------------------------------------------------------------------------

/** The schema's type, ignoring "null" in union types like `["string", "null"]`. */
function schemaType(schema: Record<string, unknown>): string | undefined {
  const type = schema.type;
  if (typeof type === "string") return type;
  if (Array.isArray(type)) return type.find((t): t is string => typeof t === "string" && t !== "null");
  if (isRecord(schema.properties)) return "object";
  return undefined;
}

function enumOptions(schema: Record<string, unknown>): (string | number)[] {
  return Array.isArray(schema.enum)
    ? schema.enum.filter((option): option is string | number => typeof option === "string" || typeof option === "number")
    : [];
}

function dateFormat(format: unknown): DateFormat | undefined {
  return format === "date-time" || format === "date" || format === "time" ? format : undefined;
}

function objectFields(schema: Record<string, unknown>, depth: number): InputField[] {
  if (!isRecord(schema.properties)) return [];
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
  return Object.entries(schema.properties).map(([key, property]) => toField(key, isRecord(property) ? property : {}, required.has(key), depth));
}

function toField(key: string, schema: Record<string, unknown>, required: boolean, depth: number): InputField {
  const title = typeof schema.title === "string" ? schema.title.trim() : "";
  const description = typeof schema.description === "string" ? schema.description.trim() : "";
  const base: BaseField = {
    key,
    label: title || humanizeKey(key),
    description: description || undefined,
    required,
    default: schema.default,
  };
  const options = enumOptions(schema);
  if (options.length > 0) return { ...base, kind: "enum", options };
  if (depth > MAX_DEPTH) return { ...base, kind: "json" };

  switch (schemaType(schema)) {
    case "string": {
      const format = dateFormat(schema.format);
      if (format) return { ...base, kind: "date", format };
      const long = typeof schema.maxLength === "number" ? schema.maxLength > 200 : LONG_TEXT_KEY.test(key);
      return { ...base, kind: "text", multiline: long && typeof schema.format !== "string" };
    }
    case "number":
    case "integer":
      return {
        ...base,
        kind: "number",
        integer: schemaType(schema) === "integer",
        minimum: typeof schema.minimum === "number" ? schema.minimum : undefined,
        maximum: typeof schema.maximum === "number" ? schema.maximum : undefined,
      };
    case "boolean":
      return { ...base, kind: "boolean" };
    case "array": {
      const items = isRecord(schema.items) ? schema.items : {};
      const itemOptions = enumOptions(items);
      if (itemOptions.length > 0) return { ...base, kind: "multiselect", options: itemOptions };
      // Items aren't "required": an empty item gets a "fill in or remove" error from the list instead.
      const item = toField("", items, false, depth + 1);
      // Items with no type at all are free-form JSON; a list of those reads better as one JSON box.
      return item.kind === "json" ? { ...base, kind: "json" } : { ...base, kind: "array", item };
    }
    case "object": {
      const fields = objectFields(schema, depth + 1);
      return fields.length > 0 ? { ...base, kind: "object", fields } : { ...base, kind: "json" };
    }
    default:
      return { ...base, kind: "json" };
  }
}

// ---- Data <-> form values ----------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

/** An ISO timestamp as the `YYYY-MM-DDTHH:mm` a datetime-local input shows, in local time. */
function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The form value for `value` (a default, or input pasted as JSON), falling back to the field's default. */
export function toFormValue(field: InputField, value: unknown = field.default): FormValue {
  switch (field.kind) {
    case "text":
      return typeof value === "string" ? value : "";
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    case "boolean":
      return value === true;
    case "enum":
      if (field.options.some((option) => option === value)) return String(value);
      return field.required ? String(field.options[0]) : "";
    case "date":
      if (typeof value !== "string") return "";
      if (field.format === "date-time") return toLocalDateTime(value);
      return field.format === "date" ? value.slice(0, 10) : value.slice(0, 8);
    case "multiselect":
      return Array.isArray(value) ? field.options.filter((option) => value.includes(option)).map(String) : [];
    case "array":
      return Array.isArray(value) ? value.map((item) => toFormValue(field.item, item)) : [];
    case "object": {
      const source = isRecord(value) ? value : {};
      return Object.fromEntries(field.fields.map((child) => [child.key, toFormValue(child, source[child.key])]));
    }
    case "json":
      return value === undefined ? "" : JSON.stringify(value, null, 2);
  }
}

function buildSpec(fields: InputField[], input: unknown): InputFormSpec {
  const source = isRecord(input) ? input : {};
  return { fields, initialValues: Object.fromEntries(fields.map((field) => [field.key, toFormValue(field, source[field.key])])) };
}

/** Form fields for an object schema with properties, or undefined when the schema can't be shown as a form. */
export function buildInputForm(schema: unknown): InputFormSpec | undefined {
  if (!isRecord(schema) || schemaType(schema) !== "object") return undefined;
  const fields = objectFields(schema, 0);
  return fields.length > 0 ? buildSpec(fields, undefined) : undefined;
}

/** Form values for input edited as JSON, so switching back to the form keeps it. */
export function formValuesFromInput(fields: InputField[], input: unknown): FormObject {
  return buildSpec(fields, input).initialValues;
}

/** The agent that receives the run input: the first node without dependencies. */
export function firstAgent(
  flow: FlowDefinition,
  resolveAgent: (agentId: string) => AgentDefinition | undefined,
): AgentDefinition | undefined {
  const root = flow.nodes.find((node) => node.dependsOn.length === 0) ?? flow.nodes[0];
  return root ? resolveAgent(root.agentId) : undefined;
}

export type FormResult = { ok: true; value: Record<string, unknown> } | { ok: false; errors: Record<string, string> };

/** Path of a nested field, used for control ids and error keys: `filters.0.name`. */
export const fieldPath = (parent: string, key: string | number) => (parent ? `${parent}.${key}` : String(key));

type Collected = { value: unknown } | undefined;

/** Whether the user left a value untouched: no text, toggles off, empty lists, or objects with only those. */
function isBlank(value: FormValue | undefined): boolean {
  if (value === undefined || value === false) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.values(value).every(isBlank);
}

/** The input value for one field, or undefined when it was left empty. Problems go into `errors`. */
function collectField(field: InputField, raw: FormValue | undefined, path: string, errors: Record<string, string>): Collected {
  const missing = (): Collected => {
    if (field.required) errors[path] = "Required.";
    return undefined;
  };
  switch (field.kind) {
    case "boolean":
      return { value: raw === true };
    case "multiselect": {
      const picked = asList(raw).map(asText);
      const values = field.options.filter((option) => picked.includes(String(option)));
      return values.length > 0 || field.required ? { value: values } : undefined;
    }
    case "array": {
      const items = asList(raw);
      if (items.length === 0) return field.required ? { value: [] } : undefined;
      const values = items.map((item, index) => {
        const itemPath = fieldPath(path, index);
        const collected = collectField(field.item, item, itemPath, errors);
        if (!collected && !errors[itemPath]) errors[itemPath] = "Fill this in or remove it.";
        return collected?.value;
      });
      return { value: values };
    }
    case "object": {
      // An optional object nobody touched is left out rather than failing on its required fields.
      if (!field.required && isBlank(raw)) return undefined;
      const source = asObject(raw);
      const value: Record<string, unknown> = {};
      for (const child of field.fields) {
        const collected = collectField(child, source[child.key], fieldPath(path, child.key), errors);
        if (collected) value[child.key] = collected.value;
      }
      return { value };
    }
    default:
      break;
  }

  const text = asText(raw);
  if (text.trim() === "") return missing();
  switch (field.kind) {
    case "text":
      return { value: text };
    case "number": {
      const number = Number(text);
      if (!Number.isFinite(number)) errors[path] = "Must be a number.";
      else if (field.integer && !Number.isInteger(number)) errors[path] = "Must be a whole number.";
      else if (field.minimum !== undefined && number < field.minimum) errors[path] = `Must be at least ${field.minimum}.`;
      else if (field.maximum !== undefined && number > field.maximum) errors[path] = `Must be at most ${field.maximum}.`;
      else return { value: number };
      return undefined;
    }
    case "enum": {
      const option = field.options.find((candidate) => String(candidate) === text);
      if (option !== undefined) return { value: option };
      errors[path] = "Pick one of the options.";
      return undefined;
    }
    case "date": {
      if (field.format === "date") return { value: text };
      if (field.format === "time") return { value: text.length === 5 ? `${text}:00` : text };
      const date = new Date(text);
      if (!Number.isNaN(date.getTime())) return { value: date.toISOString() };
      errors[path] = "Must be a valid date and time.";
      return undefined;
    }
    case "json":
      try {
        return { value: JSON.parse(text) };
      } catch {
        errors[path] = "Must be valid JSON.";
        return undefined;
      }
  }
}

/** Builds the run input from the form values. Empty optional fields are left out. */
export function collectInput(fields: InputField[], values: FormObject): FormResult {
  const errors: Record<string, string> = {};
  const value: Record<string, unknown> = {};
  for (const field of fields) {
    const collected = collectField(field, values[field.key], field.key, errors);
    if (collected) value[field.key] = collected.value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}
