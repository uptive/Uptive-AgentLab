// Node-only (Electron main, scripts, tests). Runs model calls through the local Claude Code CLI in
// headless mode (`claude -p`), which uses the logged-in Claude.ai subscription instead of API billing.
// Exposed via `@agentlab/optimization/models`; never import it from the renderer.
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { DEFAULT_EVALUATOR_MODEL } from "../evaluatorModels.js";
import type { JsonRequest, ModelClient } from "../types.js";

export interface ClaudeCliOptions {
  /** Path or name of the CLI binary. Defaults to $CLAUDE_BIN, then `claude` on PATH. */
  bin?: string;
  /** Model id or alias passed to --model when a request names none. Defaults to $AGENT_MODEL, then Sonnet 5. */
  model?: string;
  /** Kill the call after this long. Defaults to 5 minutes. */
  timeoutMs?: number;
}

/** Shape of `claude -p --output-format json`, limited to the fields we use. */
interface CliEnvelope {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  api_error_status?: number | null;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
}

export class ClaudeCliError extends Error {
  constructor(
    readonly kind: "not-installed" | "not-logged-in" | "usage-limit" | "timeout" | "invalid-output" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

const NOT_LOGGED_IN = /not logged in|please run \/login|\/login|invalid api key|authentication|unauthorized|oauth/i;
const USAGE_LIMIT = /usage limit|limit reached|limit will reset|resets? at|rate limit|quota/i;

function classifyFailure(text: string, status?: number | null): ClaudeCliError {
  const excerpt = text.trim().slice(0, 300);
  if (status === 429 || USAGE_LIMIT.test(text)) {
    return new ClaudeCliError("usage-limit", `Claude usage limit reached for your plan. Try again after it resets. (${excerpt})`);
  }
  if (status === 401 || status === 403 || NOT_LOGGED_IN.test(text)) {
    return new ClaudeCliError("not-logged-in", "Claude Code is not logged in. Run `claude` in a terminal and log in with your Claude.ai account.");
  }
  return new ClaudeCliError("failed", `Claude Code call failed: ${excerpt || "no output"}`);
}

/** Reads the model's JSON answer out of the CLI envelope: `structured_output` if present, else `result` parsed again. */
export function parseCliOutput(stdout: string, stderr = ""): unknown {
  let envelope: CliEnvelope;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope;
  } catch {
    throw classifyFailure(`${stdout}\n${stderr}`);
  }

  if (envelope.is_error || envelope.subtype !== "success") {
    throw classifyFailure(`${envelope.result ?? ""}\n${stderr}`, envelope.api_error_status);
  }
  if (envelope.structured_output !== undefined && envelope.structured_output !== null) return envelope.structured_output;

  const raw = envelope.result ?? "";
  try {
    return JSON.parse(raw);
  } catch {
    console.error("[claude-cli] result is not valid JSON:\n" + raw);
    throw new ClaudeCliError("invalid-output", `Claude answered with text instead of JSON: "${raw.slice(0, 200)}${raw.length > 200 ? "…" : ""}"`);
  }
}

/** Environment for the CLI without API credentials, so it always uses the logged-in subscription. */
function subscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

export function createClaudeCliModelClient(options: ClaudeCliOptions = {}): ModelClient {
  const bin = options.bin ?? process.env.CLAUDE_BIN ?? "claude";
  const defaultModel = options.model ?? process.env.AGENT_MODEL ?? DEFAULT_EVALUATOR_MODEL;
  const timeoutMs = options.timeoutMs ?? 5 * 60_000;

  return {
    generateJson({ system, prompt, schema, model = defaultModel }: JsonRequest) {
      const args = [
        "-p",
        "--output-format",
        "json",
        // No built-in tools and no MCP servers: evaluators only read the prompt and answer.
        "--tools",
        "",
        "--strict-mcp-config",
        // Ignore user/project settings (hooks, permissions) and don't keep a session on disk.
        "--setting-sources",
        "",
        "--no-session-persistence",
        "--model",
        model,
        "--system-prompt",
        system,
        "--json-schema",
        JSON.stringify(schema),
      ];

      return new Promise<unknown>((resolve, reject) => {
        // spawn (not execFile) so the prompt goes through stdin: no argument-length limit and no
        // shell, and a large Run fixture never ends up on the command line.
        // cwd is a temp dir so the CLI doesn't pick up this repo's CLAUDE.md or settings.
        const child = spawn(bin, args, { cwd: tmpdir(), env: subscriptionEnv(), stdio: ["pipe", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };

        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          finish(() => reject(new ClaudeCliError("timeout", `Claude Code did not answer within ${Math.round(timeoutMs / 1000)}s.`)));
        }, timeoutMs);

        child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

        child.on("error", (error: NodeJS.ErrnoException) =>
          finish(() =>
            reject(
              error.code === "ENOENT"
                ? new ClaudeCliError(
                    "not-installed",
                    `Claude Code CLI not found ("${bin}"). Install Claude Code, or set CLAUDE_BIN to its full path (apps started from the Dock don't see your shell PATH).`,
                  )
                : error,
            ),
          ),
        );

        child.on("close", (code) =>
          finish(() => {
            try {
              resolve(parseCliOutput(stdout, stderr));
            } catch (error) {
              if (code !== 0 && !stdout.trim()) reject(classifyFailure(stderr || `exit code ${code}`));
              else reject(error);
            }
          }),
        );

        child.stdin.on("error", () => {}); // the close handler reports failures
        child.stdin.end(prompt);
      });
    },
  };
}
