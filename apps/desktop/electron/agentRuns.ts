import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { createRequire } from "node:module";
import { cp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentDefinition, AuthSource, FlowDefinition, McpServerDefinition, McpServerInput, Run, SkillDefinition, TraceEvent } from "@agentlab/contracts";
import { demoAgents } from "@agentlab/agent-runtime";
import { createClaudeAgentRuntime, createClaudeCodeJsonClient, getClaudeAuthStatus, testMcpServer, type ClaudeAuthStatus } from "@agentlab/agent-runtime/claude";
import { createMcpServerFileStore, createSkillFileStore, parseSkillFile } from "@agentlab/agent-runtime/library";
import { createFlowEngine, dummyAgents } from "@agentlab/flow-engine";
import { IPC, type ImportResult, type LibraryMcpServer, type StartRunRequest } from "./api.js";
import { SecretStore } from "./secrets.js";

// Runs flows for real with the Claude runtime, and manages the skill and MCP libraries.

const WORKSPACE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The Claude Code binary the Agent SDK drives. Packaged apps ship it under resources/claude
 * (see scripts/copy-claude-binary.mjs); in development it comes from the SDK's platform package.
 */
export function claudeBinaryPath(): string | undefined {
  const exe = process.platform === "win32" ? "claude.exe" : "claude";
  if (app.isPackaged) return path.join(process.resourcesPath, "claude", exe);
  try {
    const fromDesktop = createRequire(path.join(app.getAppPath(), "package.json"));
    const sdkDir = path.dirname(fromDesktop.resolve("@anthropic-ai/claude-agent-sdk"));
    const fromSdk = createRequire(path.join(sdkDir, "package.json"));
    const platformPkg = fromSdk.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return path.join(path.dirname(platformPkg), exe);
  } catch {
    return undefined; // let the SDK find it
  }
}

export interface AgentRunsDeps {
  /** A saved agent (local folder or MongoDB); may reject when the database is unreachable. */
  getAgent: (id: string) => Promise<AgentDefinition | undefined>;
  /** Folder for committed library data (skills/, mcp-servers/). */
  dataDir: string;
}

const secretRefFor = (serverId: string) => `mcp:${serverId}`;

export function registerAgentRunIpc(deps: AgentRunsDeps) {
  const skills = createSkillFileStore(process.env.SKILLS_DIR || path.join(deps.dataDir, "skills"));
  const mcpServers = createMcpServerFileStore(process.env.MCP_SERVERS_DIR || path.join(deps.dataDir, "mcp-servers"));
  const secrets = new SecretStore(path.join(app.getPath("userData"), "secrets.json"));
  const workspaceRoot = path.join(app.getPath("userData"), "workspaces");
  const pathToClaudeCodeExecutable = claudeBinaryPath();
  const inspectOptions = { pathToClaudeCodeExecutable };
  const active = new Map<string, AbortController>();

  void pruneWorkspaces(workspaceRoot);

  const broadcast = (channel: string, payload: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const builtinAgents = (): AgentDefinition[] => {
    const ids = new Set(demoAgents.map((a) => a.id));
    return [...demoAgents, ...dummyAgents.filter((a) => !ids.has(a.id))];
  };

  /** Saved agents win over built-in ones with the same id. */
  async function resolveAgents(flow: FlowDefinition): Promise<Map<string, AgentDefinition>> {
    const resolved = new Map<string, AgentDefinition>();
    const builtins = builtinAgents();
    for (const id of new Set(flow.nodes.map((n) => n.agentId))) {
      const saved = await deps.getAgent(id).catch((error) => {
        console.warn(`[runs] could not look up agent ${id}, trying built-in agents:`, (error as Error).message);
        return undefined;
      });
      // Listed agents carry a UI-only source tag; keep it out of run snapshots.
      const { source: _source, ...agent } = (saved ?? builtins.find((a) => a.id === id) ?? {}) as AgentDefinition & { source?: string };
      if (agent.id) resolved.set(id, agent);
    }
    return resolved;
  }

  ipcMain.handle(IPC.startRun, async (_e, request: StartRunRequest) => {
    const { flow, input, folder } = request;
    if (folder && !(await stat(folder).then((s) => s.isDirectory(), () => false))) throw new Error(`Folder not found: ${folder}`);
    const agents = await resolveAgents(flow);
    const missing = flow.nodes.filter((n) => !agents.has(n.agentId)).map((n) => n.agentId);
    if (missing.length > 0) throw new Error(`Unknown agents in this flow: ${[...new Set(missing)].join(", ")}`);

    const controller = new AbortController();
    let authSource: AuthSource | undefined;
    const snapshot = { flow, agents: [...agents.values()], input };
    const sendEvent = (event: TraceEvent) => broadcast(IPC.runEvent, event);
    const runtime = createClaudeAgentRuntime({
      skillsDir: skills.dir,
      workspaceRoot,
      resolveMcpServer: (id) => mcpServers.get(id),
      resolveSecret: (ref) => secrets.get(ref),
      additionalDirectories: folder ? [folder] : [],
      onEvent: sendEvent,
      onAuth: (source) => (authSource ??= source),
      signal: controller.signal,
      pathToClaudeCodeExecutable,
    });
    const engine = createFlowEngine({ runtime, resolveAgent: (id) => agents.get(id), onEvent: sendEvent });

    return new Promise<{ runId: string }>((resolve, reject) => {
      let runId: string | undefined;
      engine
        .execute(flow, input, {
          signal: controller.signal,
          onRunUpdate: (run: Run) => {
            if (!runId) {
              runId = run.id;
              active.set(runId, controller);
              resolve({ runId });
            }
            broadcast(IPC.runUpdate, { ...run, ...snapshot, ...(authSource ? { authSource } : {}) });
          },
        })
        .then((run) => {
          // The engine leaves unscheduled steps pending when a run is stopped; show them as cancelled.
          const steps = controller.signal.aborted
            ? run.steps.map((step) => (step.status === "pending" ? { ...step, status: "failed" as const, error: "Cancelled by user" } : step))
            : run.steps;
          broadcast(IPC.runUpdate, { ...run, steps, ...snapshot, authSource: authSource ?? "unknown" });
        })
        .catch((error) => (runId ? console.error("[runs] run crashed:", error) : reject(error)))
        .finally(() => runId && active.delete(runId));
    });
  });

  ipcMain.handle(IPC.cancelRun, async (_e, runId: string) => {
    active.get(runId)?.abort();
  });

  ipcMain.handle(IPC.pickFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openDirectory" as const] };
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    return result.canceled ? undefined : result.filePaths[0];
  });

  let authCache: Promise<ClaudeAuthStatus> | undefined;
  ipcMain.handle(IPC.authStatus, async (_e, refresh?: boolean) => {
    if (refresh || !authCache) authCache = getClaudeAuthStatus(inspectOptions);
    return authCache;
  });
  ipcMain.handle(IPC.builtinAgents, async () => builtinAgents());

  // ---- Skills ------------------------------------------------------------------------------
  ipcMain.handle(IPC.listSkills, () => skills.list());
  ipcMain.handle(IPC.saveSkill, (_e, skill: SkillDefinition) => skills.save(skill));
  ipcMain.handle(IPC.deleteSkill, (_e, name: string) => skills.delete(name));
  ipcMain.handle(IPC.revealSkill, async (_e, name: string) => {
    if (await skills.get(name)) shell.showItemInFolder(path.join(skills.folderOf(name), "SKILL.md"));
  });
  ipcMain.handle(IPC.importSkills, async (event): Promise<ImportResult> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const options = { properties: ["openDirectory" as const, "multiSelections" as const], message: "Choose skill folders (each containing a SKILL.md)" };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const result: ImportResult = { imported: [], skipped: [] };
    if (picked.canceled) return result;
    for (const folder of picked.filePaths) {
      const label = path.basename(folder);
      try {
        const skill = parseSkillFile(label, await readFile(path.join(folder, "SKILL.md"), "utf8"));
        const name = skill.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
        await skills.save({ ...skill, name }); // validates; writes SKILL.md
        // Copy supporting files (scripts, templates) next to it, without overwriting the saved SKILL.md.
        await cp(folder, skills.folderOf(name), { recursive: true, filter: (src) => path.basename(src) !== "SKILL.md" });
        result.imported.push(name);
      } catch (error) {
        result.skipped.push({ name: label, reason: (error as NodeJS.ErrnoException).code === "ENOENT" ? "No SKILL.md in this folder" : (error as Error).message });
      }
    }
    return result;
  });

  // ---- MCP servers ---------------------------------------------------------------------------
  const toEntry = async (server: McpServerDefinition): Promise<LibraryMcpServer> => ({
    ...server,
    hasSecret: server.secretRef ? await secrets.has(server.secretRef) : false,
  });

  ipcMain.handle(IPC.listMcpServers, async () => Promise.all((await mcpServers.list()).map(toEntry)));

  ipcMain.handle(IPC.saveMcpServer, async (_e, input: McpServerInput, secret?: string | null) => {
    const ref = secretRefFor(input.id);
    if (typeof secret === "string" && secret.trim()) await secrets.set(ref, secret.trim());
    if (secret === null) await secrets.delete(ref);
    const keepRef = typeof secret === "string" ? Boolean(secret.trim()) : secret === null ? false : Boolean(input.secretRef) && (await secrets.has(ref));
    const saved = await mcpServers.save({ ...input, secretRef: keepRef ? ref : undefined });
    return toEntry(saved);
  });

  ipcMain.handle(IPC.deleteMcpServer, async (_e, id: string) => {
    await secrets.delete(secretRefFor(id));
    return mcpServers.delete(id);
  });

  ipcMain.handle(IPC.testMcpServer, async (_e, id: string) => {
    const server = await mcpServers.get(id);
    if (!server) throw new Error(`MCP server "${id}" is not registered`);
    const secret = server.secretRef ? await secrets.get(server.secretRef) : undefined;
    return testMcpServer(server, secret, inspectOptions);
  });

  ipcMain.handle(IPC.importClaudeDesktop, async (): Promise<ImportResult> => importClaudeDesktop(mcpServers, secrets));

  // Evaluators use the API key when one is set, otherwise the Claude Code login (subscription).
  return { jsonClient: createClaudeCodeJsonClient(inspectOptions) };
}

function claudeDesktopConfigPath(): string {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (process.platform === "win32") return path.join(process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

/** Copies MCP servers from Claude Desktop's config. A single env var is stored as the server's secret. */
async function importClaudeDesktop(store: ReturnType<typeof createMcpServerFileStore>, secrets: SecretStore): Promise<ImportResult> {
  const file = claudeDesktopConfigPath();
  let config: { mcpServers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; type?: string }> };
  try {
    config = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`No Claude Desktop configuration found at ${file}`);
  }
  const result: ImportResult = { imported: [], skipped: [] };
  const existing = new Set((await store.list()).map((s) => s.id));
  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    const id = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "server";
    if (existing.has(id)) {
      result.skipped.push({ name, reason: "Already added" });
      continue;
    }
    const envEntries = Object.entries(entry.env ?? {});
    if (envEntries.length > 1) {
      result.skipped.push({ name, reason: "Needs several environment variables; add it by hand" });
      continue;
    }
    try {
      const input: McpServerInput = entry.url
        ? { id, name, transport: { type: "http", url: entry.url } }
        : { id, name, transport: { type: "stdio", command: entry.command ?? "", args: entry.args ?? [] } };
      if (envEntries.length === 1) {
        const [envVar, value] = envEntries[0];
        await secrets.set(secretRefFor(id), value);
        Object.assign(input, { secretRef: secretRefFor(id), secretEnvVar: envVar });
      }
      await store.save(input);
      result.imported.push(name);
    } catch (error) {
      result.skipped.push({ name, reason: (error as Error).message });
    }
  }
  return result;
}

/** Step workspaces hold copied skills and anything agents wrote; keep a week for debugging. */
async function pruneWorkspaces(root: string) {
  try {
    for (const name of await readdir(root)) {
      const dir = path.join(root, name);
      if (Date.now() - (await stat(dir)).mtimeMs > WORKSPACE_MAX_AGE_MS) await rm(dir, { recursive: true, force: true });
    }
  } catch {
    // No workspaces yet.
  }
}
