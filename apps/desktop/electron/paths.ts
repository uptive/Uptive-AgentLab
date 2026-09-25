import { app } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Every place where development and the installed app keep files differently. In development
// everything sits in the repo; installed, the app bundle is read-only, so writable data goes to
// the user data folder (macOS: ~/Library/Application Support/AgentLab, Windows: %APPDATA%\AgentLab).

// Installed, keep data in ".../AgentLab" rather than the npm package name ("@agentlab/desktop"),
// which development keeps using so existing dev data stays where it is. Must run before any getPath.
if (app.isPackaged) app.setPath("userData", path.join(app.getPath("appData"), "AgentLab"));

/** dist-electron/, where the bundled main process runs from. */
const bundleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(bundleDir, "../../..");

const userData = () => app.getPath("userData");

export const paths = {
  /** Candidate .env files; the first one found is loaded. Installed apps read one from the user data folder. */
  envFiles: (): string[] =>
    app.isPackaged ? [path.join(userData(), ".env")] : [path.resolve(bundleDir, "../.env"), path.join(repoRoot, ".env")],
  localAgentsDir: (): string =>
    process.env.LOCAL_AGENTS_DIR || (app.isPackaged ? path.join(userData(), "local-agents") : path.join(repoRoot, "data", "local-agents")),
  /** Library data (skills/, mcp-servers/): committed in the repo during development. */
  dataDir: (): string => (app.isPackaged ? userData() : path.join(repoRoot, "data")),
  /** The repo, for its .mcp.json; there is none in an installed app. */
  repoRoot: (): string | undefined => (app.isPackaged ? undefined : repoRoot),
  indexHtml: path.join(bundleDir, "../dist/index.html"),
  preload: path.join(bundleDir, "preload.cjs"),
  /** Installed apps get their icon from electron-builder. */
  devIcon: (): string | undefined => (app.isPackaged ? undefined : path.join(bundleDir, "../build/icon.png")),
};
