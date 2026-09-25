import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Where this machine's Claude Code bridge token lives: outside the repo, readable only by the user.
 * `pnpm mcp:setup` creates it and `.mcp.json`'s headersHelper reads it (scripts/agentlab-mcp.mjs;
 * keep the path in sync). It can't go in safeStorage because that helper runs outside Electron.
 */
export const bridgeTokenPath = () => path.join(os.homedir(), ".agentlab", "mcp-token");

/** The bridge token, or undefined when it hasn't been set up. Any error other than a missing file is thrown. */
export async function readBridgeToken(file = bridgeTokenPath()): Promise<string | undefined> {
  try {
    return (await readFile(file, "utf8")).trim() || undefined;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}
