import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServerEntry, McpSource, McpSourceKind } from "./api.js";

type RawServer = Record<string, unknown>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const keysOf = (value: unknown) => (isObject(value) ? Object.keys(value) : []);

/**
 * Normalizes one server entry. Env and header values often hold tokens, so only their
 * names leave the main process.
 */
function toEntry(name: string, raw: RawServer): McpServerEntry {
  const url = typeof raw.url === "string" ? raw.url : undefined;
  const type = typeof raw.type === "string" ? raw.type : undefined;
  return {
    name,
    transport: type === "sse" ? "sse" : type === "http" || (url && !raw.command) ? "http" : "stdio",
    command: typeof raw.command === "string" ? raw.command : undefined,
    args: Array.isArray(raw.args) ? raw.args.map(String) : undefined,
    url,
    envKeys: keysOf(raw.env),
    headerKeys: keysOf(raw.headers),
    disabled: raw.disabled === true ? true : undefined,
  };
}

function toEntries(servers: unknown): McpServerEntry[] {
  if (!isObject(servers)) return [];
  return Object.entries(servers)
    .filter((entry): entry is [string, RawServer] => isObject(entry[1]))
    .map(([name, raw]) => toEntry(name, raw));
}

async function readJson(filePath: string): Promise<{ json?: Record<string, unknown>; status: McpSource["status"]; error?: string }> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "missing" };
    return { status: "invalid", error: (error as Error).message };
  }
  try {
    const json = JSON.parse(text);
    return isObject(json) ? { json, status: "ok" } : { status: "invalid", error: "Not a JSON object" };
  } catch (error) {
    return { status: "invalid", error: (error as Error).message };
  }
}

/** A file whose servers sit under `mcpServers`, or (as some plugins ship them) at the top level. */
async function mcpFile(kind: McpSourceKind, label: string, filePath: string): Promise<McpSource> {
  const { json, status, error } = await readJson(filePath);
  const servers = json ? toEntries(isObject(json.mcpServers) ? json.mcpServers : json) : [];
  return { kind, label, path: filePath, status, error, servers };
}

/** Claude Desktop: the manual config file plus one-click extensions (.mcpb/.dxt). */
async function claudeDesktop(appDataDir: string): Promise<McpSource[]> {
  const dir = path.join(appDataDir, "Claude");
  const configPath = path.join(dir, "claude_desktop_config.json");
  const { json, status, error } = await readJson(configPath);
  const sources: McpSource[] = [
    { kind: "claude-desktop", label: "Claude Desktop config", path: configPath, status, error, servers: toEntries(json?.mcpServers) },
  ];

  const extensionsDir = path.join(dir, "Claude Extensions");
  const extensions = await readdir(extensionsDir, { withFileTypes: true }).catch(() => []);
  const servers: McpServerEntry[] = [];
  for (const extension of extensions.filter((entry) => entry.isDirectory())) {
    const { json: manifest } = await readJson(path.join(extensionsDir, extension.name, "manifest.json"));
    const server = isObject(manifest?.server) ? manifest.server : undefined;
    if (!manifest || !isObject(server?.mcp_config)) continue;
    const name = String(manifest.display_name ?? manifest.name ?? extension.name);
    servers.push({ ...toEntry(name, server.mcp_config), version: typeof manifest.version === "string" ? manifest.version : undefined });
  }
  if (extensions.length > 0) {
    sources.push({ kind: "claude-desktop", label: "Claude Desktop extensions", path: extensionsDir, status: "ok", servers });
  }
  return sources;
}

/** Claude Code: user scope and local (per-project) scope in ~/.claude.json, plus plugin-bundled servers. */
async function claudeCode(home: string): Promise<McpSource[]> {
  const configPath = path.join(home, ".claude.json");
  const { json, status, error } = await readJson(configPath);
  const sources: McpSource[] = [
    { kind: "claude-code", label: "Claude Code (user)", path: configPath, status, error, servers: toEntries(json?.mcpServers) },
  ];
  for (const [projectPath, project] of Object.entries(isObject(json?.projects) ? json.projects : {})) {
    const servers = isObject(project) ? toEntries(project.mcpServers) : [];
    if (servers.length > 0) {
      sources.push({ kind: "claude-code", label: `Claude Code (local) · ${path.basename(projectPath)}`, path: projectPath, status: "ok", servers });
    }
  }

  const { json: installed } = await readJson(path.join(home, ".claude", "plugins", "installed_plugins.json"));
  for (const [pluginId, installs] of Object.entries(isObject(installed?.plugins) ? installed.plugins : {})) {
    const install = Array.isArray(installs) ? installs.find(isObject) : undefined;
    if (typeof install?.installPath !== "string") continue;
    const source = await mcpFile("plugin", `Plugin · ${pluginId.split("@")[0]}`, path.join(install.installPath, ".mcp.json"));
    if (source.status !== "missing") sources.push(source);
  }
  return sources;
}

/** Every MCP configuration this machine has that we know how to read. Missing files are reported, not thrown. */
export async function listMcpSources(options: { appDataDir: string; repoRoot: string; home?: string }): Promise<McpSource[]> {
  const home = options.home ?? os.homedir();
  const groups = await Promise.all([
    claudeDesktop(options.appDataDir),
    claudeCode(home),
    mcpFile("project", "This repo (.mcp.json)", path.join(options.repoRoot, ".mcp.json")).then((source) => [source]),
    mcpFile("cursor", "Cursor", path.join(home, ".cursor", "mcp.json")).then((source) => [source]),
  ]);
  return groups.flat();
}
