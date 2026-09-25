// Turns a tool call into a short sentence ("Read file · src/main.ts") instead of raw JSON.

export interface ToolSummary {
  /** What the agent did, e.g. "Run command". */
  title: string;
  /** The one argument that matters, e.g. the path or the command. */
  detail?: string;
  /** Show `detail` in a monospace font (paths, commands, patterns). */
  mono: boolean;
}

const str = (value: unknown): string | undefined => (typeof value === "string" && value.trim() ? value : undefined);

const field = (input: unknown, ...keys: string[]): string | undefined => {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value;
  }
  return undefined;
};

/** "mcp__github__create_issue" -> "github · create issue"; other names are returned as they are. */
export function toolDisplayName(toolName: string | undefined): string {
  if (!toolName) return "Tool";
  const mcp = /^mcp__(.+?)__(.+)$/.exec(toolName);
  return mcp ? `${mcp[1]} · ${mcp[2].replace(/_/g, " ")}` : toolName;
}

export function summarizeToolCall(toolName: string | undefined, input: unknown): ToolSummary {
  switch (toolName) {
    case "Read":
      return { title: "Read file", detail: field(input, "file_path", "path"), mono: true };
    case "Write":
      return { title: "Write file", detail: field(input, "file_path", "path"), mono: true };
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return { title: "Edit file", detail: field(input, "file_path", "notebook_path", "path"), mono: true };
    case "Bash":
      return { title: "Run command", detail: field(input, "command"), mono: true };
    case "Grep": {
      const pattern = field(input, "pattern");
      const path = field(input, "path", "glob");
      return { title: "Search in files", detail: pattern && path ? `${pattern}  in ${path}` : pattern, mono: true };
    }
    case "Glob":
      return { title: "Find files", detail: field(input, "pattern"), mono: true };
    case "WebFetch":
      return { title: "Open web page", detail: field(input, "url"), mono: false };
    case "WebSearch":
      return { title: "Search the web", detail: field(input, "query"), mono: false };
    case "Task":
    case "Agent":
      return { title: "Hand off to a sub-agent", detail: field(input, "description", "prompt"), mono: false };
    case "TodoWrite": {
      const todos = input && typeof input === "object" ? (input as { todos?: unknown }).todos : undefined;
      return { title: "Update to-do list", detail: Array.isArray(todos) ? `${todos.length} items` : undefined, mono: false };
    }
    default:
      return { title: toolDisplayName(toolName), mono: false };
  }
}
