import type { ToolRef } from "@agentlab/contracts";

// Renderer-safe: no Node or SDK imports. Shared by the agent editor and the Claude runtime.

export interface BuiltinToolInfo {
  name: string;
  label: string;
  description: string;
  /** Tools that can change files or run commands; the editor warns before enabling them. */
  risky?: boolean;
}

/** Claude Code tools an agent can be granted. Anything not granted is unavailable to the agent. */
export const BUILTIN_TOOLS: BuiltinToolInfo[] = [
  { name: "Read", label: "Read files", description: "Read files in the run's workspace and granted folders." },
  { name: "Glob", label: "Find files", description: "Find files by name pattern." },
  { name: "Grep", label: "Search in files", description: "Search file contents." },
  { name: "WebSearch", label: "Web search", description: "Search the web." },
  { name: "WebFetch", label: "Fetch web page", description: "Read a web page by URL." },
  { name: "Write", label: "Write files", description: "Create files in the run's workspace.", risky: true },
  { name: "Edit", label: "Edit files", description: "Change existing files.", risky: true },
  { name: "Bash", label: "Run commands", description: "Run shell commands on this computer.", risky: true },
];

export interface FunctionToolInfo {
  id: string;
  label: string;
  description: string;
}

/** In-process tools implemented by the app (see claude/functionTools.ts). */
export const FUNCTION_TOOLS: FunctionToolInfo[] = [
  { id: "current_time", label: "Current time", description: "Returns the current date and time." },
];

// Tool ids used by older agent files and demo agents before tool kinds were split up.
const LEGACY_BUILTIN_ALIASES: Record<string, string> = {
  read_file: "Read",
  grep_search: "Grep",
  "web-search": "WebSearch",
  web_search: "WebSearch",
  "fetch-url": "WebFetch",
  fetch_url: "WebFetch",
};

const builtinNames = new Set(BUILTIN_TOOLS.map((t) => t.name));

/** The built-in tool a ToolRef means, if any (handles legacy ids and kinds). */
export function builtinToolName(ref: ToolRef): string | undefined {
  if (ref.kind === "builtin") return builtinNames.has(ref.name) ? ref.name : builtinNames.has(ref.id) ? ref.id : undefined;
  if (ref.kind === "mcp" && ref.serverId) return undefined;
  return LEGACY_BUILTIN_ALIASES[ref.id] ?? LEGACY_BUILTIN_ALIASES[ref.name];
}

/** MCP tool names are `mcp__<server>__<tool>`; server names must be simple identifiers. */
export function mcpServerKey(serverId: string): string {
  return serverId.replace(/[^A-Za-z0-9_-]/g, "_");
}
