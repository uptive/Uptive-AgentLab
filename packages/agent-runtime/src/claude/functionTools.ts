import { createSdkMcpServer, tool, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FUNCTION_TOOLS } from "../tools.js";
import type { JevClient, JevResponse } from "../jev/runtime.js";
import { FUNCTION_SERVER } from "./options.js";

// Function tools run inside the app process and are exposed to Claude as an in-process MCP server,
// so "function" and "mcp" tools go through the same mechanism. Add new ones here and in FUNCTION_TOOLS.

const questionSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    type: z.literal("noul"),
    instructions: z.string().min(1),
    criteria: z.object({ true: z.string().optional(), false: z.string().optional() }).optional(),
  }),
  z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    type: z.literal("choice"),
    instructions: z.string().min(1),
    criteria: z.record(z.string().min(1), z.string().nullable()).refine((criteria) => Object.keys(criteria).length >= 2, "At least two criteria are required"),
  }),
  z.object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
    type: z.literal("score"),
    instructions: z.string().min(1),
    criteria: z.tuple([z.string().min(1), z.string().min(1)]).rest(z.string().min(1)),
  }),
]);
const questionsSchema = z
  .array(questionSchema)
  .min(1)
  .max(50)
  .refine((questions) => new Set(questions.map((question) => question.id)).size === questions.length, "Question ids must be unique");

const staticDefinitions = {
  current_time: tool("current_time", "Returns the current date and time in ISO 8601 and the local time zone.", {}, async () => ({
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ iso: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
      },
    ],
  })),
};

export const FUNCTION_TOOL_IDS: ReadonlySet<string> = new Set(FUNCTION_TOOLS.map((t) => t.id));

export interface FunctionToolServerConfig {
  jevClient?: JevClient;
  signal?: AbortSignal;
  onJevCall?: (response: JevResponse) => void;
}

/** An in-process MCP server with only the given function tools. */
export function createFunctionToolServer(ids: string[], config: FunctionToolServerConfig = {}): McpServerConfig {
  const jevDefinition = tool(
    "typesafe_system_one",
    "Ask TypeSafe Jev one or more typed questions about state. Use for fast classification, scoring, routing, or yes/no judgments; not for text generation.",
    {
      state: z.unknown().describe("Text or JSON-compatible state to evaluate"),
      model: z.string().optional().describe("Jev model; defaults to jev-latest"),
      questions: questionsSchema,
    },
    async ({ state, model, questions }) => {
      if (!config.jevClient) throw new Error("TypeSafe Jev is not configured on this computer");
      const response = await config.jevClient.evaluate({ state, model, questions }, config.signal);
      config.onJevCall?.(response);
      return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
    },
  );
  const tools = [
    ...(ids.includes("current_time") ? [staticDefinitions.current_time] : []),
    ...(ids.includes("typesafe_system_one") ? [jevDefinition] : []),
  ];
  return createSdkMcpServer({
    name: FUNCTION_SERVER,
    version: "1.0.0",
    tools,
  });
}
