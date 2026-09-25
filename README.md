# Uptive-AgentLab

AI Agent Control Center — a desktop tool to build, orchestrate, run, observe and improve AI agent flows. See `AI_Workshop.docx` for the full brief.

## Structure

pnpm workspace monorepo:

- `packages/contracts` — shared TypeScript types everyone builds against: `AgentDefinition`, `AgentResult`, `FlowDefinition`, `Run`, `StepRun`, `TraceEvent`, `EvaluationResult`, `Recommendation`, `Usage`.
- `packages/agent-runtime` — **Group 1**: agent definitions + `AgentRuntime.run(agent, input, context)`.
- `packages/flow-engine` — **Group 2**: flow definitions + sequential/parallel execution engine.
- `packages/observability` — **Group 3**: run/telemetry storage and querying.
- `packages/optimization` — **Group 4**: evaluator agents that analyze runs/flows and produce recommendations.
- `apps/desktop` — the Mac/Windows desktop shell (Electron + Vite + React). Minimal sidebar nav with one stub view per area (Agents / Flows / Runs / Optimize) — each group fills in its own view.

## Setup

Requires Node 20+ and [pnpm](https://pnpm.io).

```bash
pnpm install
```

## MongoDB (telemetry storage)

Runs and trace events are persisted to MongoDB Atlas by the Electron main process (`@agentlab/observability/mongo`). The renderer reaches it through `window.agentlab.telemetry` (see `apps/desktop/electron/preload.ts`).

### Agents API (for all groups)

Agents come from two stores behind the `AgentStore` contract (`packages/contracts/src/agent.ts`):

- **Database** — the MongoDB `agents` collection, shared with the team.
- **Local** — one JSON file per agent in `data/local-agents/`, which is gitignored. The folder is read at app startup and again when you press Refresh in the Agents view (`load({ reloadLocal: true })`), and local agents keep working when MongoDB is unreachable. A file without an `id` uses its file name as the id. Set `LOCAL_AGENTS_DIR` to use a different folder.

From any renderer view:

```ts
const agents = await window.agentlab.agents.list(); // both stores; each agent has source: "local" | "database"
const { agents, databaseError } = await window.agentlab.agents.load(); // also says why database agents are missing
const agent = await window.agentlab.agents.get(id);
const created = await window.agentlab.agents.create({ name, role, model, systemInstructions, tools: [] }); // MongoDB
const local = await window.agentlab.agents.create(input, "local"); // data/local-agents/
await window.agentlab.agents.update(id, { name: "New name" }); // partial; undefined clears a field
await window.agentlab.agents.delete(id);
```

`name`, `role`, `model` and `systemInstructions` are required. `update` and `delete` go to whichever store holds the agent. For tests and mocks, use `createMemoryAgentStore()` from `@agentlab/agent-runtime`, which follows the same contract.

Copy `.env.example` to `.env` in the repo root and fill in `MONGODB_URI` (optionally `MONGODB_DB`, default `agentlab`). `.env` is gitignored — never commit credentials.

## Theming (light / dark)

All colors, shadows and fonts live in `apps/desktop/src/theme.css` as CSS variables, with one block for light and one for dark. The sidebar button switches `data-theme` on `<html>`; the choice is remembered, and until one is made the OS setting is followed.

In components, never hard-code colors. Use the `theme` tokens from `apps/desktop/src/theme.ts` (e.g. `style={{ color: theme.textSecondary }}`) or `var(--color-...)` in CSS. Plain `h1`/`p`/form elements are already themed by the base styles. To add a token, add it to both blocks in `theme.css` and to `theme` in `theme.ts`.

## Run the desktop app (dev mode)

```bash
pnpm dev:desktop
```

This starts Vite + Electron with hot reload.

## Run flows from Claude Code

The desktop app can host a local MCP server, so Claude Code in this repo can list your saved flows
and start runs. Runs execute in the app, so you can follow them live under **Runs**, where they are
marked "from Claude Code". The server is off until you set up a token.

Each person sets this up once on their own machine:

1. Run `pnpm mcp:setup`. It creates a random token in `~/.agentlab/mcp-token`, readable only by you.
   The token never goes in the repo, `.env` or your shell, and it only works on your machine.
2. Start (or restart) the app with `pnpm dev:desktop`. The log shows `[claude-code] bridge listening on …`.
3. Start `claude` in the repo and approve the `agentlab` server from `.mcp.json`. Claude Code gets the
   token by running `scripts/agentlab-mcp.mjs headers` (the `headersHelper`), so there is nothing to export.
4. Ask something like "list the AgentLab flows and run Review with topic X".

If `/mcp` shows the server as failed: a refused connection means the app isn't running (or
`AGENTLAB_MCP_PORT` differs between the app's `.env` and your shell); a 401 means the app was started
before the token existed, so restart it. To get a new token, delete `~/.agentlab/mcp-token`, run
`pnpm mcp:setup` again and restart the app.

The tools are `list_flows`, `get_flow` (steps and the input schema), `start_run`, `list_agents`,
`get_agent`, `start_agent_run` (one agent as a one-step flow), `get_run` (with `waitSeconds` to wait
for the result), `cancel_run` and `list_runs`. The server only listens on 127.0.0.1, rejects browser
requests, and only runs flows and agents that are already saved.

## Typecheck everything

```bash
pnpm typecheck
```

## Package the desktop app

```bash
pnpm --filter @agentlab/desktop package:mac   # -> apps/desktop/release
pnpm --filter @agentlab/desktop package:win
```

## Working with the shared contracts

All packages depend on `@agentlab/contracts` via the workspace (`workspace:*`), so editing a type there is immediately visible to every package with no build step in between. Land contract changes early and in the open — the group interfaces (`AgentRuntime`, `FlowEngine`, `TelemetryStore`, `Evaluator`) are the seams between groups, so build against mocks/fixtures rather than waiting on another group's implementation.
