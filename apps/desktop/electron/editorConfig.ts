import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectEntry, ProjectsState } from "./api.js";

/**
 * Persisted editor configuration (`<userData>/editor-config.json`).
 * It only stores *where* flows live; flow metadata is always read from the files.
 */
export interface EditorConfig {
  version: 1;
  /** Directory where newly created flows are saved. */
  flowsDirectory: string;
  flows: { filePath: string; lastOpenedAt?: string }[];
}

export class EditorConfigStore {
  private config: EditorConfig | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    readonly configPath: string,
    private readonly defaultFlowsDirectory: string,
  ) {}

  async load(): Promise<EditorConfig> {
    if (this.config) return this.config;
    let loaded: Partial<EditorConfig> = {};
    try {
      loaded = JSON.parse(await readFile(this.configPath, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("Ignoring unreadable editor config:", err);
    }
    this.config = {
      version: 1,
      flowsDirectory: typeof loaded.flowsDirectory === "string" ? loaded.flowsDirectory : this.defaultFlowsDirectory,
      flows: Array.isArray(loaded.flows)
        ? loaded.flows.filter((f) => f && typeof f.filePath === "string").map((f) => ({ filePath: f.filePath, lastOpenedAt: f.lastOpenedAt }))
        : [],
    };
    return this.config;
  }

  /** Serialises mutations and persists them atomically. */
  update(mutate: (config: EditorConfig) => void): Promise<EditorConfig> {
    const next = this.queue.then(async () => {
      const config = await this.load();
      mutate(config);
      await mkdir(path.dirname(this.configPath), { recursive: true });
      const tmp = `${this.configPath}.tmp`;
      await writeFile(tmp, JSON.stringify(config, null, 2) + "\n", "utf8");
      await rename(tmp, this.configPath);
      return config;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async isRegistered(filePath: string): Promise<boolean> {
    const config = await this.load();
    return config.flows.some((f) => f.filePath === filePath);
  }

  register(filePath: string, opened = true) {
    return this.update((c) => {
      const existing = c.flows.find((f) => f.filePath === filePath);
      const lastOpenedAt = opened ? new Date().toISOString() : existing?.lastOpenedAt;
      if (existing) existing.lastOpenedAt = lastOpenedAt;
      else c.flows.push({ filePath, lastOpenedAt });
    });
  }

  unregister(filePath: string) {
    return this.update((c) => {
      c.flows = c.flows.filter((f) => f.filePath !== filePath);
    });
  }

  async state(): Promise<ProjectsState> {
    const config = await this.load();
    const flows = await Promise.all(config.flows.map((f) => describeFlowFile(f.filePath, f.lastOpenedAt)));
    flows.sort((a, b) => (b.lastOpenedAt ?? b.modifiedAt ?? "").localeCompare(a.lastOpenedAt ?? a.modifiedAt ?? ""));
    return { configPath: this.configPath, flowsDirectory: config.flowsDirectory, flows };
  }

  async entry(filePath: string): Promise<ProjectEntry> {
    const config = await this.load();
    return describeFlowFile(filePath, config.flows.find((f) => f.filePath === filePath)?.lastOpenedAt);
  }
}

/** Reads just enough of a flow file to show it in the project list. */
export async function describeFlowFile(filePath: string, lastOpenedAt?: string): Promise<ProjectEntry> {
  let modifiedAt: string;
  try {
    modifiedAt = (await stat(filePath)).mtime.toISOString();
  } catch {
    return { filePath, lastOpenedAt, status: "missing" };
  }
  try {
    const doc = JSON.parse(await readFile(filePath, "utf8"));
    if (typeof doc?.id !== "string" || typeof doc?.name !== "string" || !Array.isArray(doc?.nodes)) throw new Error();
    return {
      filePath,
      id: doc.id,
      name: doc.name,
      description: typeof doc.description === "string" ? doc.description : undefined,
      nodeCount: doc.nodes.length,
      modifiedAt,
      lastOpenedAt,
      status: "ok",
    };
  } catch {
    return { filePath, modifiedAt, lastOpenedAt, status: "invalid" };
  }
}
