import { createSdkMcpServer, tool, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { FUNCTION_TOOLS } from "../tools.js";
import { FUNCTION_SERVER } from "./options.js";

// Function tools run inside the app process and are exposed to Claude as an in-process MCP server,
// so "function" and "mcp" tools go through the same mechanism. Add new ones here and in FUNCTION_TOOLS.

const definitions = {
  current_time: tool("current_time", "Returns the current date and time in ISO 8601 and the local time zone.", {}, async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ iso: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      },
    ],
  })),
};

export const FUNCTION_TOOL_IDS: ReadonlySet<string> = new Set(FUNCTION_TOOLS.map((t) => t.id).filter((id) => id in definitions));

/** An in-process MCP server with only the given function tools. */
export function createFunctionToolServer(ids: string[]): McpServerConfig {
  return createSdkMcpServer({
    name: FUNCTION_SERVER,
    version: "1.0.0",
    tools: ids.flatMap((id) => (id in definitions ? [definitions[id as keyof typeof definitions]] : [])),
  });
}
