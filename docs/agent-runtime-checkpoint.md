# Agent runtime: checkpoint (2026-09-24)

Branch `feature/agent-sdk-runtime`. Agents run for real with the Claude Agent SDK, which drives the Claude Code binary as a subprocess. Credentials come from the Claude Code login (subscription), `CLAUDE_CODE_OAUTH_TOKEN` (headless subscription), or `ANTHROPIC_API_KEY` (API billing), with no code change between them.

## What works

- **Runtime** (`packages/agent-runtime/src/claude/`): `createClaudeAgentRuntime()` implements `AgentRuntime`.
  - Each step runs in its own workspace folder (`<userData>/workspaces/<runId>/<stepRunId>`).
  - No user settings, CLAUDE.md or personal skills are loaded.
  - Only the tools granted to the agent are available; everything else is denied (`permissionMode: "dontAsk"`).
  - Trace events: `agent_start`, `model_call` (one per model message), `tool_call` (from hooks) and `agent_end`.
  - Limits: `maxCostUsd` (SDK budget), `maxTokens` (aborts the step), and `modelSettings.maxTurns` / `effort`.
  - An `outputSchema` becomes structured output.
- **Tools**: built-in Claude Code tools (Read, Grep, WebSearch, …), MCP servers (a whole server or single tools), and in-process function tools (`current_time`). Tool ids from older agent files (`read_file`, `web-search`, …) map to the built-in tools.
- **Skills**: `data/skills/<name>/SKILL.md`. An agent's skills are copied into its step workspace, and only those are enabled. Agents with skills also need the Skill tool, and the runtime adds it automatically.
- **MCP servers**: `data/mcp-servers/<id>.json`. Tokens are stored encrypted with Electron `safeStorage` in `<userData>/secrets.json`, never in `data/`. "Test connection" lists a server's tools without a model call. MCP servers can be imported from Claude Desktop.
- **Desktop**:
  - Runs view: starts, reruns and cancels real runs, with live progress, and can grant read access to a folder.
  - Tools & skills view.
  - Agent editor: tool, skill and model pickers, plus effort and max turns (temperature removed: current models reject it).
  - Sidebar shows what pays for runs (subscription or API key).
- **Runs** carry snapshots of the flow and agents they executed (`Run.flow`, `Run.agents`) and `Run.authSource`.
- **Optimize evaluators** use the API when `ANTHROPIC_API_KEY` is set, and otherwise go through Claude Code (subscription).
- **Contracts**: `ToolRef.kind` is `builtin | mcp | function` (with `serverId` / `toolName`); `AgentDefinition.skills`; `McpServerDefinition`, `SkillDefinition` and their stores. `MODEL_CATALOG` moved to `@agentlab/contracts`.

## How to run and test

```bash
pnpm install
pnpm dev:desktop                                  # needs `claude` login or ANTHROPIC_API_KEY
pnpm --filter @agentlab/agent-runtime test        # unit tests (scripted SDK stream)
pnpm --filter @agentlab/agent-runtime test:e2e    # real Claude: flow, skill, function tool, MCP, JSON client
```

To drive the app from scripts, set `AGENTLAB_DEBUG_PORT=9333` for a DevTools protocol port (development only).

If `pnpm dev:desktop` says "Electron failed to install", run `node node_modules/.pnpm/electron@33.4.11/node_modules/electron/install.js`.

## What's left

1. **Optimize on real runs.** `apps/desktop/src/optimize/runSource.ts` still uses the fixture. Runs now have flow and agent snapshots, so `createTelemetryRunSource` can use them. Agree with Group 4 first.
2. **Flow editor.** The palette uses placeholder agents (`dummyAgentRegistry`), and "Demo run" only animates. It should list saved and built-in agents and start real runs.
3. **Packaging.** Not started. Copy the platform binary (`@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude`, ~220 MB) into `extraResources` as `claude/claude` (`claudeBinaryPath()` already looks there when packaged). Check that electron-builder includes `@anthropic-ai/claude-agent-sdk` and `mongodb` from pnpm's node_modules. Then run `package:mac` on a clean machine.
4. **Permission prompts.** Ungranted tools are refused. An "Allow this agent to…?" dialog needs `canUseTool` wired to the UI.
5. **MCP OAuth.** Only token auth works; servers that need a sign-in report `needs-auth`.
6. **Run persistence.** The renderer saves runs; closing the window mid-run loses that run. Saving from the main process would fix it, but Mongo `recordEvent` uses `insertOne`, so the renderer's full-snapshot save would then hit duplicate keys. Make it an upsert first.
7. **Later.** Skill generator ("create a skill from a description"), headless CLI (`apps/cli`), API key and Console workspaces for shared or CI use.

## Known quirks

- The SDK emits one assistant message per content block with the same usage, so the runtime de-duplicates model calls by message id.
- The agent file sync writes agents from the shared MongoDB into `data/agents/`, including other people's agents.
