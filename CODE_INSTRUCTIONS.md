# Code instructions

How we write code in AgentLab, and what needs fixing after the first vibe-coded sprint. Part 1 is the rulebook: follow it for all new code, whether a human or an agent writes it. Part 2 is the cleanup backlog from the review on 2026-09-25, in priority order. Part 3 is the proposed setup and structure.

Baseline at review time: `pnpm typecheck` passes and 71 unit tests pass (agent-runtime, flow-engine, optimization). There is no lint, no formatter, no CI, and observability has no tests.

---

## Part 1 — Rules for all new code

### Git and workflow
- **Never push to `main`.** Work on a branch (`feat/…`, `fix/…`, `chore/…`) and open a PR. At least one other person reviews before merge. Turn on branch protection on GitHub so this is enforced, not just agreed.
- Use Conventional Commit messages (`feat(runs): …`, `fix(observability): …`). Messages like "dsadas", "stuff", "importatnt" are not accepted.
- Keep PRs small and about one thing. Merge `main` into your branch before opening the PR, not after.
- Before pushing: `pnpm typecheck && pnpm lint && pnpm test` must pass (this becomes CI; see Part 3).
- Never commit secrets, `.env` files, synced data (`data/agents/`), `dist*/` output or `.claude/worktrees/`.
- Never bake secrets into a build, including ones from GitHub Actions secrets: anything in the app bundle is readable by every user. Credentials reach the app at install or run time (see `docs/releasing.md`).

### TypeScript
- `strict` stays on. Don't use `any` or `@ts-ignore`. Avoid `!` non-null assertions and `as X` casts; narrow the type instead.
- **Validate everything that crosses a trust boundary at runtime** with zod (already a dependency): IPC payloads, JSON files from disk, MongoDB documents, and LLM output. A TypeScript type on an IPC handler is not validation.
- Model variants as discriminated unions, not bags of optional fields (e.g. `ToolRef` keyed on `kind`, `TraceEvent` keyed on `type`).
- No import-time side effects in packages. For example, don't create singletons or mock engines at module scope.

### Error handling
- **Never swallow errors.** A `catch` must either handle the error in a way the user can see (UI state or a `Banner`), or rethrow it. `console.warn` and continuing is not handling.
- Every promise is awaited or given a `.catch` that updates UI state. No floating promises; lint enforces this.
- Every async effect has a cancel flag or request id, so a late response can't overwrite a newer one. `AgentsView`'s `draftRequest` ref is the pattern to copy.
- Failures have a typed reason (e.g. `failureReason: "cancelled" | "token-limit" | "cost-limit" | "error"`), never only a message string.
- Only an `ENOENT` means "file is empty/missing". Any other read or parse error is a real error.

### Electron security (non-negotiable)
- Keep `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- Every `ipcMain.handle` goes through one shared `handle(channel, schema, fn)` helper that checks the sender origin and validates the payload.
- The renderer must never be able to run arbitrary commands, arbitrary CLI args or arbitrary agent definitions. Any side effect that matters (install, delete, run with folder access) needs a confirmation in the main process or an allow-list.
- Block navigation away from the app (`will-navigate`, `will-redirect`) and set a CSP.
- Secrets go in `safeStorage` (`secrets.ts`) and nowhere else.

### Data and persistence
- Mongo writes are idempotent: use upserts or `bulkWrite` and handle `E11000`, not check-then-insert.
- Every list query has a `limit` and a cursor. Never load a whole collection into the renderer.
- Check that ids from IPC are strings before they reach a Mongo filter, to prevent operator injection.
- Write files atomically: write a temp file, then rename.
- Validate every file name built from an id or name, using one shared rule in `contracts`.

### Frontend
- Views stay under about 250 lines. Data loading and actions live in `useX()` hooks returning `{ data, loading, error }`, and the view only renders.
- Use shared UI primitives from `src/ui/` (Button, Input, Modal, Banner, StatusBadge, ConfirmDelete). Don't define your own button styles in a view.
- Colors come only from theme tokens (`theme.ts` or `var(--color-…)`), never from literals. Lint enforces this.
- Destructive actions always ask for confirmation.
- Unsaved edits are never discarded silently. Switching tabs, Escape or a backdrop click must check dirty state.
- Modals use the native `<dialog>` element via the shared `<Modal>`.

### Notifications
- Anything that tells the user about finished work (system notifications, badge, tray, Slack) goes through `RunNotifier` in the main process. Read `docs/notifications.md` first.
- Callers report what happened (`notifier.runFinished`, `reportOptimizationFinished`). They never check focus or settings, and never create `new Notification(...)` themselves.
- Notifications fire only while the window is unfocused, and never contain run input, output or secrets.

### Demo, mock and fixture code
- Fixtures and mocks live in `test/` or a `./testing` subpath export, **never** in a package's root `index.ts`.
- Demo data only appears behind `import.meta.env.DEV` or in browser-preview mode (no bridge), and is **never** written to persisted stores.

### Models and LLM calls
- Model ids and prices exist in one place only: `packages/contracts/src/models.ts` (`MODEL_CATALOG`). Everything else looks them up, for example by tier or default flag.
- Request params can differ per model. Don't send `effort` or adaptive thinking to models that reject them (e.g. Haiku 4.5).
- Run content passed to an evaluator is untrusted. Wrap it in labelled delimiters and say so in the system prompt.
- When an evaluator falls back to heuristics, show the reason in the UI.

### Tests
- Tests go in `<package>/test/`, never in `src/`.
- Every bug fix comes with a test that fails without the fix.
- Avoid timing-based tests (`setTimeout` sleeps); use fake timers or explicit signals.

---

## Part 2 — Cleanup backlog

Order: **P0** now, **P1** this sprint, **P2** next, **P3** when touching the area anyway.

### P0 — Do immediately

| # | Issue | Where | Fix |
|---|---|---|---|
| 0.1 | **MongoDB Atlas credentials are committed** and pushed to GitHub (commit `b43227d`). | `.env` | Rotate the Atlas password **now**. Then `git rm --cached .env`, and purge it from history (`git filter-repo --path .env --invert-paths`) with a coordinated force-push, or accept the history as leaked once the password is rotated. Restrict the Atlas IP allow-list. |
| 0.2 | **No navigation guard.** A link or redirect can load a remote page that gets the full `window.agentlab` bridge. | `apps/desktop/electron/main.ts:408-432` | Add `will-navigate` / `will-redirect` handlers that block non-app URLs, and check `event.senderFrame.url` in every IPC handler. |
| 0.3 | **The renderer can run arbitrary commands.** `tools:run` passes any args, cwd and input to the `claude` CLI, and `runtime:run` accepts any `AgentDefinition`. Together with 0.2 this allows remote code execution. | `main.ts:253-256`, `main.ts:283-288` | Delete `runtime:run` (the renderer doesn't need it once 2.1 is done). Limit `tools:run` to an allow-list of subcommands. |
| 0.4 | **A corrupt secrets file wipes all tokens.** A parse error resets the cache to `{}`, and the next write saves that. | `apps/desktop/electron/secrets.ts:17-21` | Treat only `ENOENT` as empty; otherwise throw, or back up the file and fail. |
| 0.5 | **Git hygiene.** `.claude/` (worktrees) and `data/agents/` (other people's agents synced from Mongo) are untracked but not ignored. | `.gitignore` | Add `.claude/worktrees/`, `data/agents/` and `dist-electron/`. Enable branch protection on `main`. |

### P1 — Correctness bugs

**Persistence (observability)**
- `telemetry:save` re-inserts every event on every flush with `insertOne`, so each save after the first throws E11000, and the error is swallowed. `packages/observability/src/mongo.ts:25`, `main.ts:394-401`. **Fix:** make `recordEvent` an upsert or unordered `bulkWrite`, send only deltas, and let errors reach the renderer's retry (`runsPersistence.ts:43-52` must rethrow).
- Once a snapshot is over 25 MB, every save fails silently and permanently. `main.ts:392`. **Fix:** incremental saves (above), and a persistent error in the UI.
- Queries are unbounded, with one `listEvents` per run (N+1). `mongo.ts:28,39`, `main.ts:380`. **Fix:** a paginated `listRuns`, and `find({ runId: { $in } })`.

**Flow engine / runtime**
- A throwing `onEvent`/`onRunUpdate` callback or a malformed runtime result leaves the step `running` and causes an unhandled rejection. `packages/flow-engine/src/executor.ts:121,132-174`. **Fix:** wrap the callbacks, and mark the step failed when `runNode` rejects.
- `maxTokens` is checked only when the next message starts, so a single-call agent is never limited. `packages/agent-runtime/src/claude/runtime.ts:201-223`. **Fix:** check on every usage update.
- A cancel during workspace setup is missed. `runtime.ts:139-146`. **Fix:** add the abort listener before the `await`.
- Aborted or limit-stopped steps report a cost of $0. `runtime.ts:246-248`. **Fix:** `estimateCostUsd(...)`.
- `maxCostUsd: 0` is ignored (truthy check). `claude/options.ts:146`.
- Skill names aren't validated before `path.join`, so a name can escape the folder. `runtime.ts:75-84`. **Fix:** reuse `SKILL_NAME` from `library.ts:8` (move it to contracts).
- `runs:start` can hang forever if the run emits no update. `apps/desktop/electron/agentRuns.ts:105-127`.
- `startRun` gives agents access to any folder the renderer names. `agentRuns.ts:83,97`. **Fix:** accept only paths returned by `pickFolder`.

**Mongo stores**
- `agents.update` passes arbitrary patch keys (including `_id` and `$`-keys) into `$set`/`$unset`. `packages/agent-runtime/src/mongo.ts:51-58`. **Fix:** allow only `AgentInput` keys.
- Check-then-insert/replace races. `flow-engine/src/mongo.ts:28-31`, `agent-runtime/src/mongo.ts:41-46`. **Fix:** a single upsert with `$setOnInsert`.
- `runId` and other ids from IPC go straight into filters (operator injection). `observability/src/mongo.ts:28,35`.
- When Mongo is down, every IPC call waits the driver's default 30 s timeout. `main.ts:107-113`. **Fix:** `serverSelectionTimeoutMS: 3000` plus a cooldown after a failure.

**Optimization**
- The Optimize view only analyzes the fixture. `apps/desktop/src/optimize/runSource.ts:56`. **Fix:** wire in `createTelemetryRunSource`, and use `run.flow`/`run.agents` snapshots, not current definitions.
- The API client sends adaptive thinking and `effort` to Haiku 4.5, so the request fails and falls back silently. `packages/optimization/src/clients/anthropic.ts:27-28`.
- LLM output is cast, not validated. `qualityLlm.ts:201-205`, `modelSelectionLlm.ts:81-85,112`. **Fix:** a zod schema per finding; drop invalid ones.
- Model-change cost logic reports "About the same cost" for a 2.5× more expensive switch, and divides by zero when usage is 0. `evaluators/modelSelection.ts:46-52`.
- Finding ids collide, so findings are silently dropped. `qualityLlm.ts:170-173`.

**Renderer**
- Demo runs are seeded into the real persisted telemetry store on every mount. `apps/desktop/src/views/RunsView.tsx:708-728`.
- Switching tabs unmounts the view and discards unsaved flow edits or an analysis in progress. `src/App.tsx:36,90`.
- Deletes without confirmation: `AgentsView.tsx:758,1072`, `LibraryView.tsx:250,269,350,369`.
- Missing `.catch` handlers leave "Loading…" forever: `RunsView.tsx:651,710`, `OptimizeView.tsx:93`, `catalog.ts:48-60`.
- Race conditions: `useServerTest` (`library/useLibrary.ts:61-80`) and `handleAnalyze` (`OptimizeView.tsx:99-131`).

### P2 — Structure and duplication

**2.1 One agent runtime.** There are two: the Agent SDK runtime (`agent-runtime/src/claude/`) and the `claude -p` wrapper (`agent-runtime/src/claudeCli.ts`). The CLI one silently drops tools, skills, limits and cancellation. **Keep the SDK runtime**, route the renderer's run IPC to it, and delete `claudeCli.ts`.

**2.2 One headless JSON client.** There are three: `optimization/src/clients/claudeCli.ts`, `agent-runtime/src/claude/inspect.ts:134` and `agent-runtime/src/claudeCli.ts`. They use different auth rules, error classification and result parsing. **Keep `createClaudeCodeJsonClient`** and move the optimization package's error classification into it.

**2.3 One way to locate the Claude binary.** Today: PATH for `tools:run`, the SDK-bundled binary for flow runs, and `CLAUDE_BIN` → bundled → PATH in `agentDraft.ts:76`. Pick one resolver.

**2.4 Split `main.ts`** (468 lines) into `ipc/{projects,agents,cloud,telemetry,tools,runs}.ts`, plus `paths.ts` for every dev-vs-packaged path decision, plus a lifecycle manager with `dispose()`. `main.ts` then only handles startup and the window.

**2.5 Typed IPC channel map.** One `{ channel: [args, result] }` map shared by main, preload and `global.d.ts`, with no string literals. Channel names are consistently `area:verbNoun` (today there is a mix of `tools:fixSetup`, `runs:pick-folder` and `optimization:generate-json`).

**2.6 Split the big views** into feature folders (see Part 3):
- `AgentsView.tsx` (1091 lines) → `useAgents`, `useAgentForm`, `AgentDrawer`, `DraftPreview`, `AgentCard`
- `RunsView.tsx` (452 lines; still holds `NewRunDialog`, move it to `runs/`) and `OptimizeView.tsx` (831 lines) → their existing `runs/` and `optimize/` folders

**2.7 Deduplicate frontend helpers:**
- The IPC error cleaner exists 5 times: `AgentsView:132`, `useLibrary:8`, `flow-editor/bridge:10`, `optimize/modelClient:15`, `RunsView:509`.
- The bridge is accessed 4 different ways.
- Button and input styles are defined 6 times.
- `StatusBadge` exists twice.
- Formatters are duplicated in OptimizeView and `runs/format.ts`.
- **Fix:** `src/lib/{bridge,errors,format}.ts` plus `src/ui/`.

**2.8 Deduplicate the Electron main process:**
- Slug code exists three times (`main.ts:173`, `agentRuns.ts:166,231`).
- The Claude Desktop config path is computed twice.
- The atomic write-queue exists twice (`secrets.ts`, `editorConfig.ts`).

**2.9 One demo agent set.** `flow-engine/src/mock/agents.ts` and `agent-runtime/src/demo.ts` define the same ids with different content. Keep one set, behind a `./testing` export.

**2.10 Remove stubs and dead code:**
- the always-throwing `runtime` export (`agent-runtime/src/index.ts:5`)
- the import-time mock `engine` (`flow-engine/src/index.ts:13`)
- `computeFlowLayers` (`flow-engine/src/demo.ts:30`)
- unused telemetry CRUD IPC channels
- stale chunks in `dist-electron/`

**2.11 Merge the two MCP screens** ("Tools & skills" library vs "MCP" read-only list of other apps' configs). Also a team decision; see `docs/agent-runtime-checkpoint.md`.

### P2 — Contracts

- `AgentRunContext.signal?: AbortSignal`; add `cancelled` and `skipped` to the run and step statuses, so the desktop app stops rewriting pending steps to `failed: "Cancelled by user"`.
- `AgentResult.failureReason` typed union.
- `ToolRef` → discriminated union on `kind`; `TraceEvent` → discriminated union on `type`.
- `ModelSettings` gets explicit `maxTurns` and `effort` fields instead of `[key]: unknown`.
- `RunSummary` exists twice (`observability/src/index.ts:221`, `optimize/runSource.ts:5`), and `ModelClient` is copied by hand (`inspect.ts:132`). Define each once, in contracts.
- Shared validators in contracts: skill name, server id, node id (no `.`, not `$input`).
- Document whether `maxTokens` counts cache reads. Optionally add a flow-level budget enforced by the executor.

### P3 — Packaging (see `docs/releasing.md`)

- No CSP in `index.html`, and fonts are loaded from Google at runtime; bundle them.

### P3 — Small stuff
- Fixture-specific checklist text sits in a production heuristic. `optimization/src/evaluators/quality.ts:174-178`.
- Timers aren't cleaned up: nested `requestAnimationFrame` in `OptimizeView.tsx:391` and `setTimeout` in `SetupView.tsx:227`.
- Nav buttons are missing `aria-current`, and the `agentlab:navigate` CustomEvent is untyped.
- Model ids are hard-coded outside the catalog: `electron/agentDraft.ts:5`, `views/AgentsView.tsx:38`, `claude/inspect.ts:143`, `optimization/src/evaluatorModels.ts:10-15`.
- `before-quit` doesn't await `client.close()`.
- `timeoutMs` is silently capped at 10 minutes. `localTools.ts:313`.
- `fileAgentStore` ids `a/b` and `a_b` map to the same file.
- The memory agent store's semantics differ from the file and Mongo stores (`agentStore.ts:36`).
- `AI_Workshop.docx` (binary brief) is in the repo; move it to Drive/Notion and link it from the README.
- `AGENTS.md` has the same block pasted twice.

---

## Part 3 — Proposed setup

### Tooling to add (one `chore/tooling` PR)
1. **Prettier** at the root: `.prettierrc` (`printWidth: 120`, which matches the current code), plus `.editorconfig`. Do one reformat commit and add it to `.git-blame-ignore-revs`.
2. **ESLint** flat config with `typescript-eslint` (type-checked), `eslint-plugin-react-hooks` and `eslint-plugin-import`. Key rules:
   - `@typescript-eslint/no-floating-promises`, `no-misused-promises`
   - `@typescript-eslint/no-explicit-any`, `no-non-null-assertion` (warn)
   - `react-hooks/exhaustive-deps` (error)
   - `no-restricted-syntax` for hex/`rgb()` literals in `.tsx`
   - `import/no-cycle`, plus a rule stopping root `index.ts` from exporting `mock/`, `demo` or `fixtures`
   - `no-console` (warn; allow in `electron/`)
3. **Root scripts:** `lint`, `format`, `test` (`pnpm -r run test`), and `check` (= typecheck + lint + test).
4. **GitHub Actions** (`.github/workflows/ci.yml`): on every PR, `pnpm install --frozen-lockfile` then `pnpm check`. Make it a required status check on `main`.
5. **Pre-commit** with `lefthook` or `husky` + `lint-staged`: Prettier and ESLint on staged files, and a secret scan with `gitleaks` so 0.1 can't happen again.
6. **Vitest workspace** at the root, so `pnpm test` runs every package. Add observability tests (debounce, hydrate, dedupe) and Mongo store tests against `mongodb-memory-server`.
7. **Dependabot** or Renovate for dependency updates.

### Target structure

```
packages/
  contracts/        types + zod schemas + shared validators + MODEL_CATALOG (single source of truth)
  agent-runtime/    ONE runtime (Agent SDK) + ONE JSON client; ./testing export for demo agents & memory store
  flow-engine/      executor/graph/schedule; ./testing export for mocks; no import-time side effects
  observability/    TelemetryStore (paginated, idempotent) + tests
  optimization/     evaluators; fixtures in test/
apps/desktop/
  electron/
    main.ts         startup + window only
    paths.ts        every dev-vs-packaged path
    ipc/            one module per area, all via handle(channel, schema, fn)
    ipcChannels.ts  typed channel map shared with preload + global.d.ts
  src/
    features/{agents,runs,optimize,library,flows,setup}/
      View.tsx  components/  hooks/  api.ts
    ui/             Button, Input, Modal, Banner, StatusBadge, ConfirmDelete
    lib/            bridge.ts, errors.ts, format.ts
```

### Suggested order of work
1. **Day 1:** do all of P0 (rotate credentials, 0.2–0.5), turn on branch protection, and open the tooling PR (Prettier, ESLint, CI).
2. **Week 1:** fix the P1 bugs, each with a test. Split the work by package owner (runtime, flows, observability, optimize, desktop).
3. **Week 2:** P2 consolidation: one runtime (2.1–2.3), typed IPC (2.4–2.5), then split the views (2.6–2.7) and tighten the contracts.
4. **Before first release:** packaging (P3) and the remaining small items.
