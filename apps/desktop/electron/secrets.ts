import { safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Secrets (MCP tokens) encrypted with the OS keychain via Electron safeStorage and kept in
 * `<userData>/secrets.json`. They never go into data/ (which is committed) or MongoDB.
 */
export class SecretStore {
  private cache: Record<string, string> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async load(): Promise<Record<string, string>> {
    if (this.cache) return this.cache;
    try {
      this.cache = JSON.parse(await readFile(this.file, "utf8"));
    } catch {
      this.cache = {};
    }
    return this.cache!;
  }

  private persist(mutate: (all: Record<string, string>) => void): Promise<void> {
    const next = this.queue.then(async () => {
      const all = await this.load();
      mutate(all);
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(`${this.file}.tmp`, JSON.stringify(all), { encoding: "utf8", mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async has(ref: string): Promise<boolean> {
    return ref in (await this.load());
  }

  async get(ref: string): Promise<string | undefined> {
    const encrypted = (await this.load())[ref];
    if (!encrypted) return undefined;
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  }

  set(ref: string, value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure storage is not available on this computer");
    const encrypted = safeStorage.encryptString(value).toString("base64");
    return this.persist((all) => {
      all[ref] = encrypted;
    });
  }

  delete(ref: string): Promise<void> {
    return this.persist((all) => {
      delete all[ref];
    });
  }
}
