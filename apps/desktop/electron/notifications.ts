import { app, BrowserWindow, dialog, Menu, Notification, powerSaveBlocker, shell, Tray, type MenuItemConstructorOptions } from "electron";
import type { Run } from "@agentlab/contracts";
import { z } from "zod";
import { IPC, type NotificationStatus, type NotificationTestResult, type OpenTarget, type WebhookTestResult } from "./api.js";
import type { Handle } from "./ipcHandle.js";
import { NotificationSettingsSchema, WEBHOOK_SECRET_REF, WebhookUrlSchema, type NotificationSettings, type NotificationSettingsStore } from "./notificationSettings.js";
import {
  describeDigest,
  describeEvent,
  DIGEST_MIN_EVENTS,
  DIGEST_WINDOW_MS,
  durationMs,
  formatDuration,
  progressOf,
  runName,
  stepSummary,
  trayTooltip,
  wantsNotification,
  wantsWebhook,
  webhookPayload,
  type NotificationMessage,
  type NotifyEvent,
  type OptimizationSummary,
  type RunOutcome,
} from "./notificationState.js";
import type { SecretStore } from "./secrets.js";
import { checkSoundFile, soundExtensions } from "./soundFile.js";
import { SoundPlayer } from "./soundPlayer.js";
import { attentionOverlay, trayIcon, type TrayState } from "./trayIcons.js";

// Tells the user about runs while they look at something else: system notifications, Dock/taskbar
// progress and badge, a tray icon with a menu of runs, and an optional Slack webhook. Runs execute
// in the main process, so all of this works with the window hidden. See docs/notifications.md.

const RECENT_RUNS = 5;
const WEBHOOK_TIMEOUT_MS = 10_000;

const OptimizationSummarySchema = z.object({
  flowName: z.string().min(1).max(200),
  recommendations: z.number().int().min(0),
  highSeverity: z.number().int().min(0),
  savedUsdPerRun: z.number().finite(),
});

export interface RunNotifierDeps {
  settings: NotificationSettingsStore;
  secrets: SecretStore;
  /** The app window, if one is open. */
  getWindow: () => BrowserWindow | undefined;
  /** Shows the app window, creating it when needed. */
  showWindow: () => BrowserWindow;
  /** Aborts a flow run, as the Stop button in the Runs view does. */
  stopRun: (runId: string) => void;
  /** Starts a finished run's flow again with the same input. */
  rerun: (run: Run) => Promise<{ runId: string }>;
}

interface NotificationOptions {
  /** Action buttons; macOS only, and only for signed builds (see docs/notifications.md). */
  actions?: { label: string; run: () => void }[];
  onClick?: () => void;
}

/** Events inside one digest window. */
interface Burst {
  events: NotifyEvent[];
  /** Individual notifications shown before the burst reached the digest size. */
  shown: Notification[];
  digest?: Notification;
}

export class RunNotifier {
  private readonly active = new Map<string, Run>();
  private readonly finished = new Set<string>();
  private readonly recent: { run: Run; outcome: RunOutcome }[] = [];
  /** Run and optimization events since the window last had focus; the Dock badge shows the count. */
  private unseen = 0;
  /** Failed runs since the window last had focus; they turn the tray icon red. */
  private readonly unseenFailures = new Set<string>();
  /** Shown notifications are kept referenced until closed, or their handlers can be garbage collected. */
  private readonly shown = new Set<Notification>();
  private burst: Burst | undefined;
  private tray: Tray | undefined;
  private sleepBlocker: number | undefined;
  private pendingOpen: OpenTarget | undefined;
  private webhookError: string | undefined;
  private soundError: string | undefined;
  private readonly sound = new SoundPlayer();
  private toldAboutTray = false;

  constructor(private readonly deps: RunNotifierDeps) {
    app.on("browser-window-focus", () => this.markSeen());
  }

  get activeCount(): number {
    return this.active.size;
  }

  // ---- Events -------------------------------------------------------------------------------

  runUpdated(run: Run): void {
    if (this.finished.has(run.id)) return; // a late snapshot after the run ended
    this.active.set(run.id, run);
    this.refresh();
  }

  runFinished(run: Run, outcome: RunOutcome): void {
    if (this.finished.has(run.id)) return; // reported once, even if a caller retries after an error
    this.active.delete(run.id);
    this.finished.add(run.id);
    this.recent.unshift({ run, outcome });
    this.recent.splice(RECENT_RUNS);
    const settings = this.deps.settings.get();
    if (wantsWebhook(settings, outcome, durationMs(run))) void this.postWebhook(webhookPayload(run, outcome));
    if (outcome === "failed" && !this.windowHasFocus()) {
      this.unseenFailures.add(run.id);
      if (process.platform === "darwin") app.dock?.bounce("informational");
      else this.deps.getWindow()?.flashFrame(true);
    }
    this.notify({ kind: "run", run, outcome });
  }

  optimizationFinished(summary: OptimizationSummary): void {
    this.notify({ kind: "optimization", ...summary });
  }

  /** Only while the window is unfocused: with focus, the open view already shows what happened. */
  private notify(event: NotifyEvent): void {
    if (!this.windowHasFocus()) {
      this.unseen++;
      if (wantsNotification(this.deps.settings.get(), event)) this.present(event);
    }
    this.refresh();
  }

  /** Shows the event, or folds it into a digest once a burst reaches DIGEST_MIN_EVENTS. */
  private present(event: NotifyEvent): void {
    if (!this.burst) {
      const burst: Burst = { events: [], shown: [] };
      this.burst = burst;
      setTimeout(() => {
        if (this.burst === burst) this.burst = undefined;
      }, DIGEST_WINDOW_MS);
    }
    const burst = this.burst;
    burst.events.push(event);
    if (burst.events.length < DIGEST_MIN_EVENTS) {
      const shown = this.showEvent(event);
      if (shown) burst.shown.push(shown);
      return;
    }
    for (const notification of burst.shown) notification.close();
    burst.shown = [];
    burst.digest?.close();
    const onlyOptimizations = burst.events.every((e) => e.kind === "optimization");
    const target: OpenTarget = onlyOptimizations ? { view: "optimize" } : { view: "runs" };
    burst.digest = this.showNotification(describeDigest(burst.events), {
      actions: [{ label: onlyOptimizations ? "View recommendations" : "View runs", run: () => this.open(target) }],
      onClick: () => this.open(target),
    });
  }

  private showEvent(event: NotifyEvent): Notification | undefined {
    const message = describeEvent(event);
    if (event.kind === "optimization") {
      const view = () => this.open({ view: "optimize" });
      return this.showNotification(message, { actions: [{ label: "View recommendations", run: view }], onClick: view });
    }
    const { run } = event;
    const view = () => this.open({ view: "runs", runId: run.id });
    const actions = [{ label: "View run", run: view }];
    if (run.flow) actions.push({ label: "Rerun", run: () => this.rerun(run) });
    return this.showNotification(message, { actions, onClick: view });
  }

  private rerun(run: Run): void {
    this.deps.rerun(run).catch((error: Error) => this.showNotification({ title: `Could not rerun ${runName(run)}`, body: error.message }));
  }

  // ---- Window -------------------------------------------------------------------------------

  /** Whether closing the window should hide it to the tray instead, so running flows keep going. */
  shouldHideOnClose(): boolean {
    return this.active.size > 0 && this.deps.settings.get().keepRunningInTray && this.tray !== undefined;
  }

  /** Tells the user once per session where the app went when its window was hidden. */
  hiddenToTray(): void {
    if (this.toldAboutTray) return;
    this.toldAboutTray = true;
    const where = process.platform === "darwin" ? "menu bar" : "system tray";
    const going = `${this.active.size} ${this.active.size === 1 ? "run is" : "runs are"} going`;
    this.showNotification({ title: "AgentLab is still running", body: `${going}. Open AgentLab from the ${where}.` }, { onClick: () => this.deps.showWindow() });
  }

  /** What the renderer should open, once. */
  takeOpenTarget(): OpenTarget | undefined {
    const target = this.pendingOpen;
    this.pendingOpen = undefined;
    return target;
  }

  private open(target: OpenTarget): void {
    this.pendingOpen = target;
    const win = this.deps.showWindow();
    // A window that is still loading asks for the target itself once the app has mounted.
    if (!win.webContents.isLoading()) win.webContents.send(IPC.openTarget);
  }

  private windowHasFocus(): boolean {
    const win = this.deps.getWindow();
    return Boolean(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized() && win.isFocused());
  }

  /** The badge clears when the window gets focus, not when a notification is clicked. */
  private markSeen(): void {
    this.deps.getWindow()?.flashFrame(false);
    if (this.unseen === 0 && this.unseenFailures.size === 0) return;
    this.unseen = 0;
    this.unseenFailures.clear();
    this.refresh();
  }

  private sendToWindow(channel: string, payload?: unknown): void {
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  }

  // ---- Notifications and webhook ------------------------------------------------------------

  private showNotification({ title, body }: NotificationMessage, options: NotificationOptions = {}): Notification | undefined {
    if (!Notification.isSupported()) return undefined;
    const actions = options.actions ?? [];
    const { sound, soundFile } = this.deps.settings.get();
    const notification = new Notification({
      title,
      body,
      // A custom sound is played by AgentLab, so the notification's own sound is turned off.
      silent: !sound || soundFile !== null,
      actions: actions.map((a) => ({ type: "button" as const, text: a.label })),
    });
    this.shown.add(notification);
    const forget = () => this.shown.delete(notification);
    notification.on("click", () => {
      forget();
      (options.onClick ?? (() => this.deps.showWindow()))();
    });
    notification.on("action", (_event, index) => {
      forget();
      actions[index]?.run();
    });
    notification.on("close", forget);
    notification.show();
    if (sound && soundFile !== null) this.playSound(soundFile);
    return notification;
  }

  /** Plays the custom sound; if it fails, beeps instead and shows why in the Notifications view. */
  private playSound(file: string): void {
    this.sound.play(file).then(
      () => this.setSoundError(undefined),
      (error: Error) => {
        shell.beep();
        console.error("[notifications] sound failed:", error.message);
        this.setSoundError(error.message);
      },
    );
  }

  private setSoundError(error: string | undefined): void {
    if (error === this.soundError) return;
    this.soundError = error;
    this.broadcastStatus().catch((e: Error) => console.error("[notifications] could not send status:", e.message));
  }

  /** Posts to the Slack webhook. Failures are kept and shown in the Notifications view. */
  private async postWebhook(payload: { text: string }): Promise<WebhookTestResult> {
    try {
      const url = await this.deps.secrets.get(WEBHOOK_SECRET_REF);
      if (!url) return { status: "not-configured" };
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`the webhook answered ${response.status} ${response.statusText}`.trim());
      this.setWebhookError(undefined);
      return { status: "sent" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[notifications] webhook post failed:", message);
      this.setWebhookError(`${new Date().toLocaleString()}: ${message}`);
      return { status: "failed", error: message };
    }
  }

  private setWebhookError(error: string | undefined): void {
    if (error === this.webhookError) return;
    this.webhookError = error;
    // The Notifications view also reads the status when it opens, so a missed push only delays it.
    this.broadcastStatus().catch((e: Error) => console.error("[notifications] could not send status:", e.message));
  }

  // ---- Indicators: progress, badge, tray, sleep ---------------------------------------------

  /** Brings every indicator in line with the current runs and settings. */
  private refresh(): void {
    const settings = this.deps.settings.get();
    const win = this.deps.getWindow();
    if (win && !win.isDestroyed()) {
      win.setProgressBar(progressOf(this.active.values()) ?? -1, { mode: this.unseenFailures.size > 0 ? "error" : "normal" });
      if (process.platform === "win32") win.setOverlayIcon(this.unseen > 0 ? attentionOverlay() : null, this.unseen > 0 ? `${this.unseen} new` : "");
    }
    if (process.platform === "darwin") app.setBadgeCount(this.unseen);

    const keepAwake = settings.preventSleep && this.active.size > 0;
    if (keepAwake && this.sleepBlocker === undefined) this.sleepBlocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!keepAwake && this.sleepBlocker !== undefined) {
      powerSaveBlocker.stop(this.sleepBlocker);
      this.sleepBlocker = undefined;
    }

    if (settings.showTray && !this.tray) this.createTray();
    if (!settings.showTray && this.tray) {
      this.tray.destroy();
      this.tray = undefined;
    }
    this.updateTray(settings);
  }

  private createTray(): void {
    this.tray = new Tray(trayIcon("idle"));
    // On Windows a left click opens the app, as tray icons there usually do; the menu is on right click.
    // On macOS any click opens the menu.
    if (process.platform !== "darwin") this.tray.on("click", () => this.deps.showWindow());
  }

  private updateTray(settings: NotificationSettings): void {
    const tray = this.tray;
    if (!tray) return;
    const failures = this.unseenFailures.size;
    const state: TrayState = failures > 0 ? "attention" : this.active.size > 0 ? "running" : "idle";
    tray.setImage(trayIcon(state));
    tray.setToolTip(trayTooltip(this.active.size, failures));
    if (process.platform === "darwin") tray.setTitle(this.active.size > 0 ? String(this.active.size) : "", { fontType: "monospacedDigit" });
    tray.setContextMenu(Menu.buildFromTemplate(this.trayMenu(settings)));
  }

  private trayMenu(settings: NotificationSettings): MenuItemConstructorOptions[] {
    const activeRuns: MenuItemConstructorOptions[] = [...this.active.values()].map((run) => ({
      label: `${runName(run)} (${stepSummary(run)})`,
      submenu: [
        { label: "Open", click: () => this.open({ view: "runs", runId: run.id }) },
        { label: "Stop…", click: () => this.confirmStop(run).catch((error: Error) => dialog.showErrorBox("Could not stop the run", error.message)) },
      ],
    }));
    const symbol: Record<RunOutcome, string> = { completed: "✓", failed: "✕", cancelled: "–" };
    const recentRuns: MenuItemConstructorOptions[] = this.recent.map(({ run, outcome }) => ({
      label: `${symbol[outcome]}  ${runName(run)} (${formatDuration(durationMs(run))})`,
      click: () => this.open({ view: "runs", runId: run.id }),
    }));
    type Toggle = "runCompleted" | "runFailed" | "optimizationFinished" | "sound";
    const toggle = (label: string, key: Toggle): MenuItemConstructorOptions => ({
      label,
      type: "checkbox",
      checked: settings[key],
      click: () =>
        this.saveSettings({ ...this.deps.settings.get(), [key]: !this.deps.settings.get()[key] }).catch((error: Error) =>
          dialog.showErrorBox("Could not save the notification setting", error.message),
        ),
    });
    return [
      { label: trayTooltip(this.active.size, this.unseenFailures.size), enabled: false },
      ...(activeRuns.length ? [{ type: "separator" as const }, ...activeRuns] : []),
      ...(recentRuns.length ? [{ type: "separator" as const }, { label: "Recent", enabled: false }, ...recentRuns] : []),
      { type: "separator" },
      { label: "Show AgentLab", click: () => this.deps.showWindow() },
      {
        label: "Notify me",
        submenu: [
          toggle("When a run finishes", "runCompleted"),
          toggle("When a run fails", "runFailed"),
          toggle("When Optimize finishes", "optimizationFinished"),
          { type: "separator" },
          toggle("Play a sound", "sound"),
        ],
      },
      { type: "separator" },
      { label: "Quit AgentLab", role: "quit" },
    ];
  }

  private async confirmStop(run: Run): Promise<void> {
    const options: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: ["Stop run", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Stop ${runName(run)}?`,
      detail: "Steps that are running are cancelled. Finished steps are kept.",
    };
    const win = this.deps.getWindow();
    const { response } = win?.isVisible() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (response === 0) this.deps.stopRun(run.id);
  }

  // ---- Settings and IPC ---------------------------------------------------------------------

  async status(): Promise<NotificationStatus> {
    return {
      settings: this.deps.settings.get(),
      supported: Notification.isSupported(),
      webhookConfigured: await this.deps.secrets.has(WEBHOOK_SECRET_REF),
      webhookError: this.webhookError,
      soundError: this.soundError,
      settingsError: this.deps.settings.loadError,
    };
  }

  private async broadcastStatus(): Promise<NotificationStatus> {
    const status = await this.status();
    this.sendToWindow(IPC.notificationStatus, status);
    return status;
  }

  private async saveSettings(settings: NotificationSettings): Promise<NotificationStatus> {
    try {
      await this.deps.settings.save(settings);
    } finally {
      this.refresh();
    }
    return this.broadcastStatus();
  }

  private async pickSoundFile(win: BrowserWindow | undefined): Promise<NotificationStatus> {
    const options: Electron.OpenDialogOptions = {
      title: "Choose a notification sound",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: soundExtensions() }],
      ...(process.platform === "darwin" ? { defaultPath: "/System/Library/Sounds" } : {}),
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const file = picked.filePaths[0];
    if (picked.canceled || !file) return this.status();
    await checkSoundFile(file);
    this.soundError = undefined;
    return this.saveSettings({ ...this.deps.settings.get(), soundFile: file, sound: true });
  }

  private async previewSound(): Promise<void> {
    const { soundFile } = this.deps.settings.get();
    if (soundFile === null) {
      shell.beep();
      return;
    }
    try {
      await this.sound.play(soundFile);
      this.setSoundError(undefined);
    } catch (error) {
      this.setSoundError((error as Error).message);
      throw error;
    }
  }

  private async setWebhookUrl(url: string | null): Promise<NotificationStatus> {
    if (url === null) await this.deps.secrets.delete(WEBHOOK_SECRET_REF);
    else await this.deps.secrets.set(WEBHOOK_SECRET_REF, url);
    this.webhookError = undefined;
    return this.broadcastStatus();
  }

  /** Shows a sample notification even with the window focused, so the user sees what they get. */
  private async sendTest(): Promise<NotificationTestResult> {
    const shown = this.showNotification({ title: "AgentLab notifications work", body: "You will see messages like this when runs finish while you are in another app." });
    const webhook = await this.postWebhook({ text: ":wave: *AgentLab:* test message. Run notifications will appear here." });
    return { notificationShown: shown !== undefined, webhook };
  }

  registerIpc(handle: Handle): void {
    handle(IPC.getNotificationStatus, z.tuple([]), () => this.status());
    // The sound file is only changed through pickSoundFile/clearSoundFile, so the renderer cannot point it at any path.
    handle(IPC.saveNotificationSettings, z.tuple([NotificationSettingsSchema]), ([settings]) =>
      this.saveSettings({ ...settings, soundFile: this.deps.settings.get().soundFile }),
    );
    handle(IPC.pickNotificationSound, z.tuple([]), (_args, event) => this.pickSoundFile(BrowserWindow.fromWebContents(event.sender) ?? undefined));
    handle(IPC.clearNotificationSound, z.tuple([]), () => {
      this.soundError = undefined;
      return this.saveSettings({ ...this.deps.settings.get(), soundFile: null });
    });
    handle(IPC.previewNotificationSound, z.tuple([]), () => this.previewSound());
    handle(IPC.setNotificationWebhook, z.tuple([WebhookUrlSchema.nullable()]), ([url]) => this.setWebhookUrl(url));
    handle(IPC.sendTestNotification, z.tuple([]), () => this.sendTest());
    handle(IPC.notifyOptimization, z.tuple([OptimizationSummarySchema]), ([summary]) => this.optimizationFinished(summary));
    handle(IPC.takeOpenTarget, z.tuple([]), () => this.takeOpenTarget());
  }

  /** Loads the saved settings and sets up the tray and indicators. */
  async start(): Promise<void> {
    try {
      await this.deps.settings.load();
    } finally {
      this.refresh();
    }
  }

  dispose(): void {
    this.sound.stop();
    if (this.sleepBlocker !== undefined) powerSaveBlocker.stop(this.sleepBlocker);
    this.sleepBlocker = undefined;
    this.tray?.destroy();
    this.tray = undefined;
  }
}
