import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readBridgeToken } from "../electron/bridgeToken.js";

describe("readBridgeToken", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "bridge-token-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("reads and trims the token", async () => {
    await writeFile(path.join(dir, "mcp-token"), "abc123\n");
    expect(await readBridgeToken(path.join(dir, "mcp-token"))).toBe("abc123");
  });

  it("treats a missing or empty file as not set up", async () => {
    expect(await readBridgeToken(path.join(dir, "missing"))).toBeUndefined();
    await writeFile(path.join(dir, "empty"), "\n");
    expect(await readBridgeToken(path.join(dir, "empty"))).toBeUndefined();
  });

  it("throws other read errors", async () => {
    await expect(readBridgeToken(dir)).rejects.toThrow();
  });
});
