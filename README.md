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
