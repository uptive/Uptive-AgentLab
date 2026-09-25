# Notifications

How AgentLab tells users about runs while they are in another app, and how to add to it. Read this before you touch anything that notifies, badges or puts something in the tray.

## What the user gets

| Surface | macOS | Windows | When |
|---|---|---|---|
| System notification | Notification Center | Toast in Action Center | A run completes, fails or is stopped, or an Optimize analysis finishes, **only while the window is unfocused** |
| Digest | one notification | one toast | 3 or more events within 10 s collapse into one ("3 runs finished") |
| Badge | red count on the Dock icon | red dot overlay on the taskbar button | Unseen events. Clears when the window gets focus, not on click-through |
| Progress | bar on the Dock icon | bar on the taskbar button | Finished steps ÷ all steps across running flows. Red while failures are unseen |
| Attention | Dock bounce | taskbar flash | A run fails while unfocused |
| Tray | menu-bar icon + running count | tray icon (left click opens the app) | Always, unless turned off. Menu: running runs (Open, Stop…), recent runs, notification toggles, Quit |
| Slack | incoming webhook | incoming webhook | Runs longer than N minutes (default 5), when enabled |
| Sound | system sound, or a chosen file played with `afplay` | system sound, or a chosen file played in a hidden audio page | With every notification, when "Play a sound" is on |

Closing the window while flows run hides it to the tray, so the runs keep going. Quitting while flows run asks first, then aborts them. The computer is kept awake while a run is going (`powerSaveBlocker`).

## Design rules

These come from the design. Keep new notifications consistent with them.

- **Only while unfocused.** With focus, the open view *is* the notification. Don't add in-app toasts for the same events.
- **Title** = the flow name plus what happened: `Support triage flow finished`. No app name, because the OS already shows it.
- **Body** = the figures from the run summary: `4 of 4 steps completed · 12.4s · 3,812 tok · $0.0214`. Failures lead with the failing step instead: `Step 3 of 5, Line-item parser: rate limit exceeded after 7.2s`.
- **Actions** only point at things that already exist in the app: View run, Rerun, View recommendations.
- **Never** put run input, output or secrets in a notification body or a webhook payload. The Slack message carries only the flow name and figures (a test checks this).
- One notification per run, never one per step.

## Where the code is

Everything is decided in the **main process**, because runs execute there and must notify with the window hidden.

| File | What it does |
|---|---|
| `apps/desktop/electron/notificationState.ts` | Pure logic with no Electron: wording (`describeRun`, `describeOptimization`, `describeDigest`), which events notify (`wantsNotification`), webhook rules, and progress. **Put new decisions here and unit test them.** |
| `apps/desktop/electron/notifications.ts` | `RunNotifier`: shows notifications and the digest, badge, progress, tray, sleep blocker, webhook, and its IPC handlers |
| `apps/desktop/electron/notificationSettings.ts` | zod schema and defaults for `<userData>/notification-settings.json`; the webhook URL secret ref and its validator |
| `apps/desktop/electron/soundFile.ts` | Which files can be notification sounds (formats per platform, 10 MB limit). Pure and tested |
| `apps/desktop/electron/soundPlayer.ts` | Plays the chosen file: `afplay` on macOS, a hidden sandboxed page with `<audio>` elsewhere |
| `apps/desktop/electron/trayIcons.ts` | Tray and overlay icons drawn in code (template glyphs on macOS, coloured on Windows) |
| `apps/desktop/electron/ipcHandle.ts` | The shared `handle(channel, schema, fn)`: checks that the sender is the app's own page and validates arguments with zod |
| `apps/desktop/electron/agentRuns.ts` | Calls `onRunUpdate` for every snapshot and `onRunFinished(run, outcome)` once per run. Also provides `rerun`, `cancelRun`, `activeRunCount` and `dispose` |
| `apps/desktop/electron/main.ts` | Creates the notifier, hide-to-tray on close, quit confirmation, and the Windows AppUserModelID |
| `apps/desktop/src/notifications/bridge.ts` | Renderer side: `reportOptimizationFinished`, and the "open this run" request used by the Runs view |
| `apps/desktop/src/notifications/NotificationsView.tsx` + `useNotificationSettings.ts` | The Notifications tab (settings, Slack webhook, test button) |
| `apps/desktop/test/notificationState.test.ts` | Tests for wording, digest, settings and webhook rules |

## How to call it

### From the main process (preferred)

If the thing that finished runs in main, call the notifier directly. For flow runs this is already wired: `agentRuns.ts` calls `onRunFinished`, and `main.ts` routes that to `notifier.runFinished(run, outcome)`. Don't call it a second time for the same run.

```ts
notifier.runFinished(run, "failed");            // outcome from outcomeOf(run, signal.aborted)
notifier.optimizationFinished({ flowName, recommendations, highSeverity, savedUsdPerRun });
```

The notifier checks focus, settings, digest and badge itself. **Callers never check focus or settings, and never build `new Notification(...)` themselves.**

### From the renderer

The renderer reports facts. It never decides whether to notify or how to word it. Optimize runs in the renderer, so it reports its result once the analysis is done:

```ts
import { reportOptimizationFinished } from "../notifications/bridge.js";

reportOptimizationFinished({ flowName, recommendations, highSeverity, savedUsdPerRun })
  .catch((e: Error) => setError(`The analysis finished, but the notification could not be sent: ${e.message}`));
```

The payload is validated in main (`OptimizationSummarySchema`).

### Opening a view from a notification or the tray

Main never pushes navigation data. It stores an `OpenTarget` (`{ view: "runs", runId? } | { view: "optimize" }`), shows the window, and sends `notifications:open`. The renderer then calls `takeOpenTarget()`. `App.tsx` does this on mount too, which covers a window that was still loading. For `runs`, `App.tsx` calls `requestOpenRun(runId)`, and `RunsView` picks that up with `useOpenRunRequest()`.

## Adding a new kind of notification

1. Add a variant to `NotifyEvent` in `notificationState.ts`, plus its wording in `describeEvent` and a line in `describeDigest`.
2. Add a setting to `NotificationSettingsSchema` with a `.default(...)`, so old settings files still parse. Map it in `wantsNotification`, and add a checkbox to `NotificationsView` and, if it's common, to the tray's "Notify me" submenu.
3. Add a public method on `RunNotifier` that calls `this.notify(event)`, and give the event its actions in `showEvent`. If a new view has to open, extend `OpenTarget` in `api.ts` and the handler in `App.tsx`.
4. If the renderer reports it: add a channel to `IPC` in `api.ts`, a method to `AgentLabApi["notifications"]` and `preload.ts`, and register it in `RunNotifier.registerIpc` with a zod schema through `handle`.
5. Add tests in `apps/desktop/test/notificationState.test.ts` and update this file.

## Custom sound

Notifications can't play an arbitrary file themselves. macOS only takes named system sounds, and Windows toasts only take `ms-winsoundevent` sounds for unpackaged apps. So when `soundFile` is set, the notification is shown `silent` and `RunNotifier.playSound` plays the file.

- **Only main sets `soundFile`**, through `notifications:pickSoundFile` (a file dialog). `notifications:saveSettings` ignores any `soundFile` in the renderer's payload, so the renderer can't point it at an arbitrary path. Keep it that way.
- **Formats:** on macOS, whatever `afplay` plays (aiff, caf, wav, mp3, m4a, aac), so the system sounds in `/System/Library/Sounds` work, and the dialog opens there. Elsewhere, what Chromium decodes (wav, mp3, ogg, opus, m4a, aac, flac). Files are limited to 10 MB and cut off after 15 s.
- **If playback fails** (file moved, can't be decoded), the app beeps (`shell.beep()`) and the reason shows under the sound picker (`NotificationStatus.soundError`).
- The Windows audio page is a hidden `BrowserWindow` with no preload, destroyed after each sound, so it never keeps the app from quitting.

## Platform notes

- **Windows** shows toasts only for apps with an AppUserModelID. `main.ts` sets `se.uptive.agentlab` when packaged (matches `build.appId`, and the NSIS shortcut carries it), and `process.execPath` in development.
- **macOS action buttons** (View run, Rerun) appear only in **signed** builds with `NSUserNotificationAlertStyle = alert` (set in `package.json` → `build.mac.extendInfo`). In development and unsigned builds, clicking the notification body still opens the run.
- **Windows action buttons** aren't supported through Electron's `actions` option. Clicking the toast opens the run.
- In development, macOS shows notifications as "Electron" with the Electron icon. The packaged app shows AgentLab.
- Do Not Disturb and Focus Assist are respected by the OS, so there's nothing to do in our code.
- Tray icons are drawn in `trayIcons.ts`, so there are no image files to add. Keep macOS glyphs black with alpha (template images), or they won't adapt to a dark menu bar.

## Testing

- Unit: `pnpm --filter @agentlab/desktop test`.
- By hand: Notifications tab → **Send a test notification**, or **Preview** next to a chosen sound. For the real flow, start a run, switch to another app, and wait. To see a digest, finish three runs within 10 s.
- Scripted: start the app with `AGENTLAB_DEBUG_PORT=9333 pnpm dev:desktop` and evaluate `window.agentlab.notifications.sendTest()` over the DevTools protocol.

## Not built yet

- **Run blocked, needs input** and **budget exceeded, still running** from the design. The flow engine has no "waiting for a decision" state and no flow-level budget (see CODE_INSTRUCTIONS P2, Contracts). Add them as new `NotifyEvent` variants when the engine supports them.
- Opening a run from a notification switches tabs, and switching tabs still discards unsaved flow edits (CODE_INSTRUCTIONS P1, Renderer). Fixing that fixes it here too.
