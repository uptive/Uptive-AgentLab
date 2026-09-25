// Copies the Claude Code binary the Agent SDK drives into build/claude/, from where electron-builder
// ships it as resources/claude/ (see "extraResources" in package.json and claudeBinaryPath() in
// electron/agentRuns.ts). The binary comes from the SDK's platform package for this machine, so
// run this on the OS and architecture you package for.
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "claude.exe" : "claude";
const arch = process.env.npm_config_arch || process.arch;

const fromDesktop = createRequire(path.join(desktopDir, "package.json"));
const sdkDir = path.dirname(fromDesktop.resolve("@anthropic-ai/claude-agent-sdk"));
const fromSdk = createRequire(path.join(sdkDir, "package.json"));
const platformPackage = `@anthropic-ai/claude-agent-sdk-${process.platform}-${arch}`;
let source;
try {
  source = path.join(path.dirname(fromSdk.resolve(`${platformPackage}/package.json`)), exe);
} catch {
  console.error(`${platformPackage} is not installed. Run pnpm install on the platform you are packaging for.`);
  process.exit(1);
}

const targetDir = path.join(desktopDir, "build", "claude");
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
await copyFile(source, path.join(targetDir, exe));
await chmod(path.join(targetDir, exe), 0o755);
console.log(`Copied ${platformPackage}/${exe} to build/claude/`);
