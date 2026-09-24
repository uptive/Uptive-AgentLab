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

Saved agents live in the `agents` collection behind the `AgentStore` contract (`packages/contracts/src/agent.ts`). From any renderer view:

```ts
const agents = await window.agentlab.agents.list();
const agent = await window.agentlab.agents.get(id);
const created = await window.agentlab.agents.create({ name, role, model, systemInstructions, tools: [] });
await window.agentlab.agents.update(id, { name: "New name" }); // partial; undefined clears a field
await window.agentlab.agents.delete(id);
```

`name`, `role`, `model` and `systemInstructions` are required.

Agents are read from MongoDB and kept in two-way sync with `data/agents/*.json` (one file per agent, safe to commit). The sync runs at startup and whenever the agent list loads: an agent missing on one side is copied over, and when both copies differ the one with the newer `updatedAt` wins. Deletions are not inferred from a missing file, so delete agents in the app, which removes both copies. Set `AGENTS_DIR` to use a different folder. For tests and mocks, use `createMemoryAgentStore()` from `@agentlab/agent-runtime`, which follows the same contract.

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

## Package the desktop app

```bash
pnpm --filter @agentlab/desktop package:mac   # -> apps/desktop/release
pnpm --filter @agentlab/desktop package:win
```

## Working with the shared contracts

All packages depend on `@agentlab/contracts` via the workspace (`workspace:*`), so editing a type there is immediately visible to every package with no build step in between. Land contract changes early and in the open — the group interfaces (`AgentRuntime`, `FlowEngine`, `TelemetryStore`, `Evaluator`) are the seams between groups, so build against mocks/fixtures rather than waiting on another group's implementation.
