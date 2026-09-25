// This machine's token for the AgentLab Claude Code bridge, kept in ~/.agentlab/mcp-token (never in
// the repo). `setup` creates it; `headers` prints the auth header for .mcp.json's headersHelper.
// Keep the path in sync with apps/desktop/electron/bridgeToken.ts.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const file = path.join(os.homedir(), ".agentlab", "mcp-token");

async function readToken() {
  try {
    return (await readFile(file, "utf8")).trim() || undefined;
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

const command = process.argv[2];
if (command === "setup") {
  if (await readToken()) {
    console.log(`Token already set up: ${file}`);
  } else {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, `${randomBytes(32).toString("hex")}\n`, { mode: 0o600, flag: "wx" });
    console.log(`Created ${file}. Restart AgentLab to turn on the Claude Code bridge.`);
  }
} else if (command === "headers") {
  const token = await readToken();
  if (!token) {
    console.error(`No AgentLab MCP token at ${file}. Run \`pnpm mcp:setup\` and restart the app.`);
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ Authorization: `Bearer ${token}` }));
} else {
  console.error("Usage: node scripts/agentlab-mcp.mjs setup|headers");
  process.exit(1);
}
