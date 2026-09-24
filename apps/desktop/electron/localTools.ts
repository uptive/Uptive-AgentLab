import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { LocalTool, ToolOutputStream, ToolRunRequest, ToolRunResult } from "./api.js";

type PerPlatform<T> = Partial<Record<NodeJS.Platform, T>> & { default: T };

interface ToolSpec {
  id: string;
  name: string;
  description: string;
  /** Executable name looked up on PATH. */
  command: string | PerPlatform<string>;
  versionArgs: string[];
  install: {
    /** Shown to the user: a command to run or a download page. */
    hint: string | PerPlatform<string>;
    docsUrl: string;
    /** Official installer the app can run for the user, per platform. */
    script?: Partial<Record<NodeJS.Platform, { file: string; args: string[] }>>;
  };
  /** Checks that an installed tool is ready to use (e.g. signed in), and how to fix it if not. */
  setup?: {
    checkArgs: string[];
    parse(stdout: string): { ready: boolean; detail: string };
    fix: { label: string; args: string[] };
  };
}

const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

/**
 * Tools the app itself depends on. Only these are detected and can be run from the renderer.
 * - claude: the agent runtime runs agents through `claude -p`.
 */
const TOOL_SPECS: ToolSpec[] = [
  {
    id: "claude",
    name: "Claude Code",
    description: "Anthropic's CLI. AgentLab runs agents through it, using your Claude subscription or API key.",
    command: "claude",
    versionArgs: ["--version"],
    install: {
      hint: { default: "curl -fsSL https://claude.ai/install.sh | bash", win32: "irm https://claude.ai/install.ps1 | iex" },
      docsUrl: "https://docs.claude.com/en/docs/claude-code/setup",
      script: {
        darwin: { file: "/bin/bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
        linux: { file: "/bin/bash", args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"] },
        win32: { file: powershell, args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"] },
      },
    },
    setup: {
      checkArgs: ["auth", "status"],
      parse(stdout) {
        try {
          const status = JSON.parse(stdout) as { loggedIn?: boolean; authMethod?: string; email?: string };
          if (!status.loggedIn) return { ready: false, detail: "Not signed in" };
          const who = [status.email, status.authMethod && `via ${status.authMethod}`].filter(Boolean).join(" ");
          return { ready: true, detail: who ? `Signed in as ${who}` : "Signed in" };
        } catch {
          return { ready: false, detail: "Could not read sign-in status" };
        }
      },
      fix: { label: "Sign in", args: ["auth", "login"] },
    },
  },
];

const forPlatform = (value: string | PerPlatform<string>) =>
  typeof value === "string" ? value : (value[process.platform] ?? value.default);

const isWindows = process.platform === "win32";
// Generous: some CLIs (e.g. claude on first launch) take a few seconds to answer --version.
const DETECT_TIMEOUT_MS = 10_000;
const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const MAX_RUN_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 1024 * 1024;

const readCommand = (file: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => {
    execFile(file, args, { timeout: DETECT_TIMEOUT_MS, windowsHide: true }, (_err, stdout) => resolve(stdout || undefined));
  });

/**
 * macOS: apps launched from Finder/the Dock get a minimal PATH (/usr/bin:/bin:...), so ask the
 * login shell for the PATH the user sees in a terminal.
 */
async function loginShellPath(): Promise<string[]> {
  const shell = process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/sh");
  const marker = "__AGENTLAB_PATH__";
  const stdout = await readCommand(shell, ["-ilc", `printf '%s' "${marker}$PATH${marker}"`]);
  // rc files may print noise, so read only what sits between the markers.
  return stdout?.split(marker)[1]?.split(path.delimiter) ?? [];
}

/**
 * Windows: installers update the Path in the registry, but a running app keeps the Path it
 * started with. Read the current machine and user Path so "Check again" sees fresh installs.
 */
async function windowsRegistryPath(): Promise<string[]> {
  const keys = ["HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment", "HKCU\\Environment"];
  const values = await Promise.all(keys.map((key) => readCommand("reg", ["query", key, "/v", "Path"])));
  return values.flatMap((stdout) => {
    const value = stdout?.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im)?.[1]?.trim();
    if (!value) return [];
    return value.replace(/%([^%]+)%/g, (whole, name: string) => process.env[name] ?? whole).split(";");
  });
}

/** The PATH to search, plus the usual per-user install locations on top. */
async function resolveSearchPath(): Promise<string> {
  const home = os.homedir();
  const dirs = isWindows ? await windowsRegistryPath() : await loginShellPath();
  dirs.push(...(process.env.PATH ?? "").split(path.delimiter));

  if (isWindows) {
    if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, "npm"));
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"));
    dirs.push(path.join(home, ".local", "bin"), path.join(home, ".bun", "bin"), path.join(home, ".cargo", "bin"));
  } else {
    dirs.push(
      path.join(home, ".local", "bin"),
      path.join(home, ".claude", "local"),
      path.join(home, ".npm-global", "bin"),
      path.join(home, ".bun", "bin"),
      path.join(home, ".cargo", "bin"),
      "/opt/homebrew/bin",
      "/usr/local/bin",
    );
  }

  const seen = new Set<string>();
  return dirs
    .map((d) => d.trim())
    .filter((d) => {
      const key = isWindows ? d.toLowerCase() : d;
      if (!d || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(path.delimiter);
}

/** process.env with PATH replaced. On Windows the key is spelled "Path", and a second spelling would be ambiguous. */
function envWithPath(searchPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toUpperCase() !== "PATH") env[key] = value;
  }
  env[isWindows ? "Path" : "PATH"] = searchPath;
  return env;
}

async function findExecutable(command: string, searchPath: string): Promise<string | undefined> {
  // On Windows only real executables count; npm also drops an extensionless sh script next to its .cmd shim.
  const exts = isWindows ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  for (const dir of searchPath.split(path.delimiter)) {
    for (const ext of exts) {
      const candidate = path.join(dir, command + ext.toLowerCase());
      try {
        if (!(await stat(candidate)).isFile()) continue;
        if (!isWindows) await access(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return undefined;
}

// Windows .cmd/.bat files (e.g. npm shims) can only be started through cmd.exe, which re-parses
// the command line. Escape like cross-spawn does so arguments reach the tool unchanged.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;
const escapeCmdCommand = (file: string) => file.replace(CMD_META, "^$1");
function escapeCmdArgument(arg: string, doubleEscape: boolean): string {
  let escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  escaped = `"${escaped}"`.replace(CMD_META, "^$1");
  return doubleEscape ? escaped.replace(CMD_META, "^$1") : escaped;
}

function spawnTool(file: string, args: string[], options: { env: NodeJS.ProcessEnv; cwd?: string }): ChildProcess {
  const common = { cwd: options.cwd, env: options.env, windowsHide: true };
  if (!(isWindows && /\.(cmd|bat)$/i.test(file))) return spawn(file, args, common);

  if (args.some((a) => /[\r\n]/.test(a))) {
    throw new Error("On Windows this tool cannot take arguments with line breaks; pass multi-line text as input instead");
  }
  const doubleEscape = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [escapeCmdCommand(file), ...args.map((a) => escapeCmdArgument(a, doubleEscape))].join(" ");
  return spawn(process.env.comspec || "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...common,
    windowsVerbatimArguments: true,
  });
}

/** Ends the process and anything it started. On Windows child.kill() would only end cmd.exe. */
function killTree(child: ChildProcess) {
  if (isWindows && child.pid !== undefined) {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
  } else {
    child.kill("SIGTERM");
  }
}

type RunOutcome = Omit<ToolRunResult, "toolId" | "durationMs">;

interface RunHandle {
  child: ChildProcess;
  cancel(): void;
}

function runProcess(
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    input?: string;
    timeoutMs: number;
    onOutput?: (stream: ToolOutputStream, chunk: string) => void;
    onStart?: (handle: RunHandle) => void;
  },
): Promise<RunOutcome> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnTool(file, args, options);
    } catch (error) {
      reject(error);
      return;
    }

    const output = { stdout: "", stderr: "" };
    let truncated = false;
    let timedOut = false;
    let cancelled = false;

    const collect = (stream: ToolOutputStream) => (chunk: string) => {
      options.onOutput?.(stream, chunk);
      const room = MAX_OUTPUT_CHARS - output[stream].length;
      if (chunk.length > room) truncated = true;
      if (room > 0) output[stream] += chunk.slice(0, room);
    };
    // setEncoding keeps multi-byte characters intact across chunk boundaries.
    child.stdout?.setEncoding("utf8").on("data", collect("stdout"));
    child.stderr?.setEncoding("utf8").on("data", collect("stderr"));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    options.onStart?.({
      child,
      cancel: () => {
        cancelled = true;
        killTree(child);
      },
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, ...output, timedOut, cancelled, truncated });
    });

    // A tool that exits before reading stdin makes the write fail with EPIPE; that's not our error.
    child.stdin?.on("error", () => {});
    child.stdin?.end(options.input ?? "");
  });
}

/** Detects the known tools and runs them. Detection is cached until `refresh()`. */
export class LocalToolRegistry {
  private searchPath?: Promise<string>;
  private tools?: Promise<LocalTool[]>;
  private readonly active = new Map<string, RunHandle>();

  list(): Promise<LocalTool[]> {
    this.tools ??= this.detectAll();
    return this.tools;
  }

  refresh(): Promise<LocalTool[]> {
    this.searchPath = undefined;
    this.tools = undefined;
    return this.list();
  }

  /**
   * Runs a known tool to completion. With `request.runId`, the run can be cancelled via
   * `cancel(runId)` and `onOutput` receives stdout/stderr as it arrives.
   */
  async run(
    request: ToolRunRequest,
    hooks: { onOutput?: (stream: ToolOutputStream, chunk: string) => void } = {},
  ): Promise<ToolRunResult> {
    const tool = (await this.list()).find((t) => t.id === request.toolId);
    if (!tool) throw new Error(`Unknown tool "${request.toolId}"`);
    if (!tool.path) throw new Error(`${tool.name} is not installed. ${tool.installHint}`);
    if (!Array.isArray(request.args) || !request.args.every((a) => typeof a === "string")) {
      throw new Error("args must be an array of strings");
    }
    const { runId } = request;

    const timeoutMs = Math.min(Math.max(1_000, request.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS), MAX_RUN_TIMEOUT_MS);
    const env = envWithPath(await this.getSearchPath());
    return this.track(runId, tool.id, (onStart) =>
      runProcess(tool.path!, request.args, {
        env,
        cwd: request.cwd,
        input: request.input,
        timeoutMs,
        onOutput: hooks.onOutput,
        onStart,
      }),
    );
  }

  /** Registers a run under its runId (so it can be cancelled) and times it. */
  private async track(
    runId: string | undefined,
    toolId: string,
    start: (onStart: (handle: RunHandle) => void) => Promise<RunOutcome>,
  ): Promise<ToolRunResult> {
    if (runId !== undefined && (typeof runId !== "string" || this.active.has(runId))) {
      throw new Error("runId must be a unique string");
    }
    const started = Date.now();
    try {
      const outcome = await start((handle) => {
        if (runId !== undefined) this.active.set(runId, handle);
      });
      return { toolId, ...outcome, durationMs: Date.now() - started };
    } finally {
      if (runId !== undefined) this.active.delete(runId);
    }
  }

  /** The installer command the app would run for this tool, or undefined if it can't install it. */
  installCommand(toolId: string): string | undefined {
    const spec = TOOL_SPECS.find((s) => s.id === toolId);
    return spec?.install.script?.[process.platform] ? forPlatform(spec.install.hint) : undefined;
  }

  /** Runs the tool's official installer, then re-detects. Callers must confirm with the user first. */
  async install(
    toolId: string,
    hooks: { runId?: string; onOutput?: (stream: ToolOutputStream, chunk: string) => void } = {},
  ): Promise<{ result: ToolRunResult; tool?: LocalTool }> {
    const script = TOOL_SPECS.find((s) => s.id === toolId)?.install.script?.[process.platform];
    if (!script) throw new Error(`AgentLab cannot install "${toolId}" on ${process.platform}`);
    const result = await this.track(hooks.runId, toolId, (onStart) =>
      runProcess(script.file, script.args, {
        env: envWithPath(process.env.PATH ?? ""),
        timeoutMs: INSTALL_TIMEOUT_MS,
        onOutput: hooks.onOutput,
        onStart,
      }),
    );
    const tool = (await this.refresh()).find((t) => t.id === toolId);
    return { result, tool };
  }

  /** Runs the tool's setup fix (e.g. `claude auth login`), then re-detects. */
  async fixSetup(
    toolId: string,
    hooks: { runId?: string; onOutput?: (stream: ToolOutputStream, chunk: string) => void } = {},
  ): Promise<{ result: ToolRunResult; tool?: LocalTool }> {
    const fix = TOOL_SPECS.find((s) => s.id === toolId)?.setup?.fix;
    if (!fix) throw new Error(`"${toolId}" has no setup step`);
    const result = await this.run({ toolId, args: fix.args, runId: hooks.runId, timeoutMs: INSTALL_TIMEOUT_MS }, hooks);
    const tool = (await this.refresh()).find((t) => t.id === toolId);
    return { result, tool };
  }

  /** Stops a run started with a runId. Returns false if it already finished. */
  cancel(runId: string): boolean {
    const handle = this.active.get(runId);
    handle?.cancel();
    return handle !== undefined;
  }

  /** Stops every running tool, e.g. when the app quits. */
  dispose() {
    for (const handle of this.active.values()) handle.cancel();
    this.active.clear();
  }

  private getSearchPath(): Promise<string> {
    this.searchPath ??= resolveSearchPath();
    return this.searchPath;
  }

  private async detectAll(): Promise<LocalTool[]> {
    const searchPath = await this.getSearchPath();
    return Promise.all(TOOL_SPECS.map((spec) => this.detect(spec, searchPath)));
  }

  private async checkSetup(spec: ToolSpec, file: string, searchPath: string): Promise<LocalTool["setup"]> {
    if (!spec.setup) return undefined;
    const { checkArgs, parse, fix } = spec.setup;
    try {
      const result = await runProcess(file, checkArgs, { env: envWithPath(searchPath), timeoutMs: DETECT_TIMEOUT_MS });
      return { ...parse(result.stdout), fixLabel: fix.label };
    } catch (error) {
      return { ready: false, detail: (error as Error).message, fixLabel: fix.label };
    }
  }

  private async detect(spec: ToolSpec, searchPath: string): Promise<LocalTool> {
    const base: LocalTool = {
      id: spec.id,
      name: spec.name,
      description: spec.description,
      command: forPlatform(spec.command),
      installed: false,
      installHint: forPlatform(spec.install.hint),
      docsUrl: spec.install.docsUrl,
      canInstall: spec.install.script?.[process.platform] !== undefined,
    };

    const found = await findExecutable(base.command, searchPath);
    if (!found) return base;

    try {
      const result = await runProcess(found, spec.versionArgs, { env: envWithPath(searchPath), timeoutMs: DETECT_TIMEOUT_MS });
      // Prefer the line with a version number; some tools print warnings first (e.g. ollama without its server).
      const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const version = lines.find((l) => /\d+\.\d+/.test(l)) ?? lines[0];
      if (result.exitCode !== 0) {
        const check = `\`${base.command} ${spec.versionArgs.join(" ")}\``;
        const error = result.timedOut
          ? `${check} did not answer within ${DETECT_TIMEOUT_MS / 1000} s`
          : `${check} exited with ${result.exitCode ?? result.signal}`;
        return { ...base, path: found, version, error };
      }
      return { ...base, installed: true, path: found, version, setup: await this.checkSetup(spec, found, searchPath) };
    } catch (error) {
      return { ...base, path: found, error: (error as Error).message };
    }
  }
}
