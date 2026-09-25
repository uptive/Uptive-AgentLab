import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/**
 * What AgentLab tells the user about runs, kept in `<userData>/notification-settings.json`.
 * Notifications only ever fire while the window is unfocused; with focus, the open view is the notification.
 */
export const NotificationSettingsSchema = z.object({
  /** System notifications per outcome. */
  runCompleted: z.boolean().default(true),
  runFailed: z.boolean().default(true),
  runCancelled: z.boolean().default(false),
  optimizationFinished: z.boolean().default(true),
  sound: z.boolean().default(true),
  /**
   * An audio file on this computer played instead of the system sound; null for the system sound.
   * Only the main process sets it (through a file dialog), never a renderer payload.
   */
  soundFile: z.string().nullable().default(null),
  /** Menu-bar icon on macOS, system tray icon on Windows. */
  showTray: z.boolean().default(true),
  /** Closing the window while runs are going hides it to the tray instead of stopping them. */
  keepRunningInTray: z.boolean().default(true),
  /** Keeps the computer from sleeping while a run is going. */
  preventSleep: z.boolean().default(true),
  /** A Slack incoming webhook for runs long enough that the user may have left the computer. */
  webhook: z
    .object({
      enabled: z.boolean().default(false),
      runCompleted: z.boolean().default(true),
      runFailed: z.boolean().default(true),
      /** Shorter runs are not posted. */
      minDurationMinutes: z.number().int().min(0).max(1440).default(5),
    })
    .prefault({}),
});

export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = NotificationSettingsSchema.parse({});

/** The webhook URL is a credential (anyone with it can post), so it lives in the SecretStore. */
export const WEBHOOK_SECRET_REF = "notifications:webhook";

export const WebhookUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((url) => url.startsWith("https://"), "The webhook URL must start with https://");

export class NotificationSettingsStore {
  private settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS;
  private queue: Promise<unknown> = Promise.resolve();
  /** Set when the file exists but could not be read; the defaults are used until the next save. */
  loadError: string | undefined;

  constructor(private readonly file: string) {}

  async load(): Promise<NotificationSettings> {
    let raw: string;
    try {
      raw = await readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.settings;
      throw error;
    }
    const parsed = NotificationSettingsSchema.safeParse(safeJson(raw));
    if (parsed.success) {
      this.settings = parsed.data;
      this.loadError = undefined;
    } else {
      this.loadError = `${this.file} could not be read, so the default settings are used. Saving replaces the file.`;
      console.error("[notifications] invalid settings file:", parsed.error.message);
    }
    return this.settings;
  }

  get(): NotificationSettings {
    return this.settings;
  }

  /** Validates, then writes atomically. Saves are serialised so a slow write never overwrites a newer one. */
  save(input: unknown): Promise<NotificationSettings> {
    const settings = NotificationSettingsSchema.parse(input);
    const next = this.queue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
      await rename(tmp, this.file);
      this.settings = settings;
      this.loadError = undefined;
      return settings;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
