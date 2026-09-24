import fs from "node:fs/promises";
import path from "node:path";
import type { McpServerDefinition, McpServerInput, McpServerStore, SkillDefinition, SkillStore } from "@agentlab/contracts";

// Node-only: file-backed stores for skills and MCP servers. Both folders are plain files that can
// be committed and shared, like data/agents/. Secrets never go in them (see McpServerDefinition.secretRef).

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function validateSkill(skill: SkillDefinition): void {
  if (!SKILL_NAME.test(skill.name)) throw new Error("Skill name must be lowercase letters, digits and hyphens (max 64 characters)");
  if (!skill.description.trim()) throw new Error("Skill description is required: it is how Claude decides when to use the skill");
  if (!skill.instructions.trim()) throw new Error("Skill instructions are required");
}

export function renderSkillFile(skill: SkillDefinition): string {
  // JSON strings are valid YAML double-quoted scalars, so descriptions with colons or newlines stay safe.
  return `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description.trim())}\n---\n\n${skill.instructions.trim()}\n`;
}

export function parseSkillFile(name: string, content: string): SkillDefinition {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { name, description: "", instructions: content.trim() };
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!field) continue;
    let value = field[2].trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        value = value.replace(/^"|"$/g, "");
      }
    } else if (value.startsWith("'")) {
      value = value.replace(/^'|'$/g, "").replace(/''/g, "'");
    }
    fields[field[1]] = value;
  }
  return { name: fields.name || name, description: fields.description ?? "", instructions: match[2].trim() };
}

/** Skills stored as `<dir>/<name>/SKILL.md`, the layout Claude Code loads skills from. */
export function createSkillFileStore(dir: string): SkillStore & { readonly dir: string; folderOf(name: string): string } {
  const folderOf = (name: string) => path.join(dir, name);
  const read = async (name: string): Promise<SkillDefinition | undefined> => {
    const file = path.join(folderOf(name), "SKILL.md");
    try {
      const [content, stat] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
      return { ...parseSkillFile(name, content), name, updatedAt: stat.mtime.toISOString() };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  return {
    dir,
    folderOf,
    async list() {
      await fs.mkdir(dir, { recursive: true });
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const skills = await Promise.all(entries.filter((e) => e.isDirectory() && SKILL_NAME.test(e.name)).map((e) => read(e.name)));
      return skills.filter((s): s is SkillDefinition => s !== undefined).sort((a, b) => a.name.localeCompare(b.name));
    },
    get: (name) => (SKILL_NAME.test(name) ? read(name) : Promise.resolve(undefined)),
    async save(skill) {
      validateSkill(skill);
      await fs.mkdir(folderOf(skill.name), { recursive: true });
      await fs.writeFile(path.join(folderOf(skill.name), "SKILL.md"), renderSkillFile(skill), "utf8");
      return (await read(skill.name))!;
    },
    async delete(name) {
      if (!SKILL_NAME.test(name) || !(await read(name))) return false;
      await fs.rm(folderOf(name), { recursive: true, force: true });
      return true;
    },
  };
}

const SERVER_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateMcpServer(input: McpServerInput): void {
  if (!SERVER_ID.test(input.id)) throw new Error("Server id must be lowercase letters, digits, '-' or '_'");
  if (!input.name.trim()) throw new Error("Server name is required");
  const t = input.transport;
  if (t?.type === "http") {
    let url: URL;
    try {
      url = new URL(t.url);
    } catch {
      throw new Error("Server URL is not a valid URL");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("Server URL must use https (http is only allowed for localhost)");
    }
  } else if (t?.type === "stdio") {
    if (!t.command.trim()) throw new Error("Command is required for a local (stdio) server");
  } else {
    throw new Error("Transport must be http or stdio");
  }
  if (input.secretEnvVar && !/^[A-Z_][A-Z0-9_]*$/.test(input.secretEnvVar)) throw new Error("Secret variable name must be UPPER_SNAKE_CASE");
}

/** MCP servers stored as `<dir>/<id>.json`. */
export function createMcpServerFileStore(dir: string): McpServerStore & { readonly dir: string } {
  const fileOf = (id: string) => path.join(dir, `${id}.json`);
  const read = async (id: string): Promise<McpServerDefinition | undefined> => {
    try {
      return JSON.parse(await fs.readFile(fileOf(id), "utf8")) as McpServerDefinition;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  };

  return {
    dir,
    async list() {
      await fs.mkdir(dir, { recursive: true });
      const servers: McpServerDefinition[] = [];
      for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith(".json")).sort()) {
        try {
          const server = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")) as McpServerDefinition;
          validateMcpServer(server);
          servers.push(server);
        } catch (error) {
          console.warn(`[mcp] skipping ${name}: ${(error as Error).message}`);
        }
      }
      return servers;
    },
    get: (id) => (SERVER_ID.test(id) ? read(id) : Promise.resolve(undefined)),
    async save(input) {
      validateMcpServer(input);
      const existing = await read(input.id);
      const now = new Date().toISOString();
      const server: McpServerDefinition = { ...input, createdAt: existing?.createdAt ?? now, updatedAt: now };
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(fileOf(input.id), `${JSON.stringify(server, null, 2)}\n`, "utf8");
      return server;
    },
    async delete(id) {
      if (!SERVER_ID.test(id) || !(await read(id))) return false;
      await fs.rm(fileOf(id), { force: true });
      return true;
    },
  };
}
