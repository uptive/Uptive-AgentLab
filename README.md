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

## Typecheck everything

```bash
pnpm typecheck
```

## Install the desktop app

Every push to `main` publishes a release. With the [GitHub CLI](https://cli.github.com) logged in:

```bash
# macOS (Apple Silicon)
gh release download -R uptive/Uptive-AgentLab -p install.sh -O - | bash
```

```powershell
# Windows (PowerShell)
gh release download -R uptive/Uptive-AgentLab -p install.ps1 -O - | Out-String | Invoke-Expression
```

See `docs/releasing.md` for Command Prompt, how the pipeline works, and packaging details.

## Package the desktop app locally

```bash
pnpm --filter @agentlab/desktop package:mac   # -> apps/desktop/release
pnpm --filter @agentlab/desktop package:win
```

## Working with the shared contracts

All packages depend on `@agentlab/contracts` via the workspace (`workspace:*`), so editing a type there is immediately visible to every package with no build step in between. Land contract changes early and in the open — the group interfaces (`AgentRuntime`, `FlowEngine`, `TelemetryStore`, `Evaluator`) are the seams between groups, so build against mocks/fixtures rather than waiting on another group's implementation.
