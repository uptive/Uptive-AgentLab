# Releasing and installing

Every push to `main` builds the desktop app and publishes it as a GitHub release, so people can install AgentLab from a terminal without cloning the repo or using pnpm.

## Install (for users)

You need the [GitHub CLI](https://cli.github.com), logged in with an account that can see `uptive/Uptive-AgentLab` (`gh auth login`). The repository is private, so plain `curl` downloads don't work.

**macOS (Apple Silicon)**, in Terminal:

```bash
gh release download -R uptive/Uptive-AgentLab -p install.sh -O - | bash
```

**Windows**, in PowerShell:

```powershell
gh release download -R uptive/Uptive-AgentLab -p install.ps1 -O - | Out-String | Invoke-Expression
```

or in Command Prompt:

```bat
powershell -NoProfile -Command "gh release download -R uptive/Uptive-AgentLab -p install.ps1 -O - | Out-String | Invoke-Expression"
```

Run the same command again to update. The scripts:

- **macOS:** download `AgentLab-mac-arm64.zip` and put `AgentLab.app` in `/Applications`, or `~/Applications` if `/Applications` isn't writable.
- **Windows:** download `AgentLab-win-x64-setup.exe` and install it silently for the current user into `%LOCALAPPDATA%\Programs\AgentLab`.
- On first install, ask for the MongoDB connection string (hidden input), or read it from a `MONGODB_URI` environment variable. They write it to the app's own `.env`:
  - macOS: `~/Library/Application Support/AgentLab/.env`
  - Windows: `%APPDATA%\AgentLab\.env`
  Leave it empty to skip. Local agents and runs work without MongoDB.

## Why credentials are not in the build

The build must never contain `MONGODB_URI` or any other secret, not even one taken from GitHub Actions secrets. Everything in the app bundle is readable by anyone who has the installer: `app.asar` is a plain archive, so a secret baked in at build time ships in plain text to every user. Credentials reach the app at install time instead (above). Non-secret defaults, such as `MONGODB_DB` or `AGENT_BACKEND`, may be set at build time.

## How the pipeline works

`.github/workflows/release.yml`:

1. **check** (Ubuntu): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm -r run test`. A failure stops the release.
2. **build** (matrix: `macos-14` for Apple Silicon, `windows-latest` for x64): sets the version to `0.1.<run number>`, then runs `package:mac` / `package:win`.
3. **release**: creates the tag `v0.1.<run number>` on the pushed commit, with generated notes. It attaches the zip, the setup exe, `scripts/install.sh` and `scripts/install.ps1`, and marks the release as latest.

It also runs from the Actions tab (**Run workflow**) without a push.

## Packaging details

- Vite bundles the main process and the renderer, including the workspace packages. Only `mongodb` and `@anthropic-ai/claude-agent-sdk` stay external, so they are the only `dependencies` in `apps/desktop/package.json`. Everything else is a `devDependency` on purpose, so electron-builder doesn't copy it into the app. If a new import has to stay external at runtime, add it to `rollupOptions.external` in `vite.config.ts` **and** to `dependencies`.
- The Claude Code binary the Agent SDK drives is copied by `scripts/copy-claude-binary.mjs` into `apps/desktop/build/claude/` (git-ignored). It ships as `resources/claude/`, where `claudeBinaryPath()` looks for it. The SDK's own copy is excluded from the bundle so the ~200 MB binary isn't shipped twice. Because the script copies the binary for the machine it runs on, each OS builds on its own runner.
- Installed apps keep their data in the user data folder (`AgentLab`, not `@agentlab/desktop`). Every dev-vs-installed path decision is in `apps/desktop/electron/paths.ts`.
- **macOS signing:** there is no Apple Developer ID yet. `scripts/adhoc-sign.cjs` ad-hoc signs the app after packaging, which Apple Silicon requires. Script installs work because `curl`/`gh` downloads carry no quarantine flag. A zip downloaded in a browser is blocked by Gatekeeper until we sign with a Developer ID and notarize.
- **Windows signing:** none yet. The silent install by script works, but double-clicking a downloaded installer shows a SmartScreen warning.

Build locally with `pnpm --filter @agentlab/desktop package:mac` (or `package:win` on Windows). The output goes to `apps/desktop/release/`.

## Not covered yet

- Intel Macs and Windows on ARM. Each needs its own runner or cross-arch binary.
- Code signing and notarization (needs an Apple Developer ID and a Windows certificate, stored as Actions secrets and used only for signing).
- Auto-update inside the app. For now, updating means running the install command again.
