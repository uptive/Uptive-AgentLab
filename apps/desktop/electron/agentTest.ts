import Ajv2020 from "ajv/dist/2020.js";
import type { ModelClient } from "@agentlab/optimization";
import type { AgentJudgeRequest, AgentJudgement, SchemaCheck } from "./api.js";

// Checks and grading for test runs started from the agent editor. Test runs are not saved.

// Formats (email, uri…) are not checked; strict mode off so schemas drafted by Claude with
// extra keywords still compile.
const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });

const hasSchema = (schema: unknown) => typeof schema === "object" && schema !== null && Object.keys(schema).length > 0;

/** Validates a value against an agent's input or output schema. */
export function checkSchema(schema: unknown, value: unknown): SchemaCheck {
  if (!hasSchema(schema)) return { status: "no-schema", errors: [] };
  let validate;
  try {
    // Drafts declare varying $schema versions; the 2020-12 validator handles the common subset of all of them.
    const { $schema: _version, ...rest } = schema as Record<string, unknown>;
    validate = ajv.compile(rest);
  } catch (error) {
    return { status: "bad-schema", errors: [(error as Error).message] };
  }
  if (validate(value)) return { status: "valid", errors: [] };
  return {
    status: "invalid",
    errors: (validate.errors ?? []).map((e) => `${e.instancePath || "(root)"} ${e.message ?? "is invalid"}`),
  };
}

const MAX_JUDGE_CHARS = 30_000;

const clip = (value: unknown) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "(none)";
  return text.length > MAX_JUDGE_CHARS ? `${text.slice(0, MAX_JUDGE_CHARS)}\n…(truncated)` : text;
};

const JUDGE_SYSTEM = `You grade one output of an AI agent. You get the agent's definition, the input it received and
the output it produced. Judge how well the output does what the system instructions ask for this input: correctness,
completeness, following the required format, and staying within scope. Do not reward length.
Score 1-5: 5 = fully meets the instructions, 4 = minor issues, 3 = usable but with clear gaps, 2 = mostly misses,
1 = wrong or unusable. List concrete issues (quote or point at the part of the output) and what was done well.
If an issue comes from unclear instructions rather than the model, say so and suggest the instruction change.
Write in the same language as the system instructions.`;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 1, maximum: 5 },
    verdict: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    issues: { type: "array", items: { type: "string" } },
  },
  required: ["score", "verdict", "strengths", "issues"],
  additionalProperties: false,
};

/** Asks Claude to score a test output against the agent's instructions. One extra model call. */
export async function judgeAgentOutput(client: ModelClient, { agent, input, output }: AgentJudgeRequest): Promise<AgentJudgement> {
  const prompt = [
    `## Agent: ${agent.name}${agent.description ? ` — ${agent.description}` : ""}`,
    `## System instructions\n${agent.systemInstructions}`,
    hasSchema(agent.outputSchema) ? `## Required output schema\n${clip(agent.outputSchema)}` : "",
    `## Input\n${clip(input)}`,
    `## Output\n${clip(output)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return (await client.generateJson({ system: JUDGE_SYSTEM, prompt, schema: JUDGE_SCHEMA })) as AgentJudgement;
}
