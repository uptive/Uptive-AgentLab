import { useState, type CSSProperties, type ReactNode } from "react";
import type { NotificationSettings, NotificationTestResult } from "../../electron/api.js";
import { theme } from "../theme.js";
import { Banner } from "../ui/Banner.js";
import { Button } from "../ui/Button.js";
import { useNotificationSettings } from "./useNotificationSettings.js";

const isMac = navigator.userAgent.includes("Macintosh");
const trayName = isMac ? "menu bar" : "system tray";

const titleStyle: CSSProperties = { fontFamily: theme.fontTitle, fontWeight: 600, color: theme.title, margin: 0 };
const card: CSSProperties = { background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: theme.cardShadow };
const hint: CSSProperties = { color: theme.textMuted, fontSize: 13, margin: "4px 0 12px" };
const input: CSSProperties = { padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.pageBg, color: theme.text, fontFamily: theme.fontBody, fontSize: 14 };

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={{ ...titleStyle, fontSize: 16 }}>{title}</h2>
      <p style={hint}>{description}</p>
      {children}
    </section>
  );
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", color: disabled ? theme.textMuted : theme.text, cursor: disabled ? "default" : "pointer" }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** The file name without its folders, for either path style. */
const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file;

function SoundPicker(props: { file: string | null; error?: string; disabled: boolean; onPick: () => void; onClear: () => void; onPreview: () => void }) {
  const { file, error, disabled, onPick, onClear, onPreview } = props;
  return (
    <div style={{ margin: "2px 0 6px 26px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: disabled ? theme.textMuted : theme.textSecondary, fontSize: 14 }} title={file ?? undefined}>
          Sound: {file ? fileName(file) : "system default"}
        </span>
        <Button onClick={onPick} disabled={disabled} style={{ padding: "4px 12px", fontSize: 13 }}>
          {file ? "Change…" : "Choose a file…"}
        </Button>
        {file ? (
          <>
            <Button onClick={onPreview} disabled={disabled} style={{ padding: "4px 12px", fontSize: 13 }}>
              Preview
            </Button>
            <Button onClick={onClear} disabled={disabled} style={{ padding: "4px 12px", fontSize: 13 }}>
              Use system sound
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p style={{ color: theme.errorText, fontSize: 13, margin: "6px 0 0" }}>{error}. Notifications beep instead until this is fixed.</p> : null}
    </div>
  );
}

function testSummary(result: NotificationTestResult): string {
  const notification = result.notificationShown ? "A test notification was shown." : "This system does not support notifications.";
  const webhook =
    result.webhook.status === "sent" ? " A test message was posted to Slack." : result.webhook.status === "failed" ? ` Slack failed: ${result.webhook.error}` : "";
  return notification + webhook;
}

export function NotificationsView() {
  const { data, loading, error, saving, save, setWebhookUrl, sendTest, pickSoundFile, clearSoundFile, previewSound, clearError } = useNotificationSettings();
  const [url, setUrl] = useState("");
  const [testResult, setTestResult] = useState<string>();

  if (loading) return <p style={{ color: theme.textMuted }}>Loading…</p>;
  if (!data) return error ? <Banner tone="error">{error}</Banner> : null;

  const { settings } = data;
  const set = (patch: Partial<NotificationSettings>) => void save({ ...settings, ...patch });
  const setWebhook = (patch: Partial<NotificationSettings["webhook"]>) => set({ webhook: { ...settings.webhook, ...patch } });

  const saveUrl = async () => {
    await setWebhookUrl(url.trim());
    setUrl("");
  };
  const runTest = async () => {
    setTestResult(undefined);
    const result = await sendTest();
    if (result) setTestResult(testSummary(result));
  };

  return (
    <div style={{ maxWidth: 720 }}>
      <h1 style={{ ...titleStyle, fontSize: 24 }}>Notifications</h1>
      <p style={{ color: theme.textMuted, marginTop: 4 }}>
        Flows can run for a long time. AgentLab tells you when they finish while you are in another app. With AgentLab in front, the open view shows what
        happened instead.
      </p>

      {error ? <Banner tone="error" onDismiss={clearError}>{error}</Banner> : null}
      {data.settingsError ? <Banner tone="error">{data.settingsError}</Banner> : null}
      {!data.supported ? <Banner tone="error">This system does not support notifications. The badge, progress bar and {trayName} icon still work.</Banner> : null}
      {testResult ? <Banner onDismiss={() => setTestResult(undefined)}>{testResult}</Banner> : null}

      <Section title="Notify me when" description="Three or more at once are combined into one notification. The badge on the app icon counts what you have not seen yet.">
        <Check label="A run finishes" checked={settings.runCompleted} onChange={(v) => set({ runCompleted: v })} />
        <Check label="A run fails" checked={settings.runFailed} onChange={(v) => set({ runFailed: v })} />
        <Check label="A run is stopped" checked={settings.runCancelled} onChange={(v) => set({ runCancelled: v })} />
        <Check label="Optimize finishes an analysis" checked={settings.optimizationFinished} onChange={(v) => set({ optimizationFinished: v })} />
        <Check label="Play a sound" checked={settings.sound} onChange={(v) => set({ sound: v })} />
        <SoundPicker
          file={settings.soundFile}
          error={data.soundError}
          disabled={!settings.sound || saving}
          onPick={() => void pickSoundFile()}
          onClear={() => void clearSoundFile()}
          onPreview={() => void previewSound()}
        />
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void runTest()} disabled={saving}>
            Send a test notification
          </Button>
        </div>
      </Section>

      <Section title="While runs are going" description={`Progress shows on the app icon in the ${isMac ? "Dock" : "taskbar"}.`}>
        <Check label={`Show AgentLab in the ${trayName}`} checked={settings.showTray} onChange={(v) => set({ showTray: v })} />
        <Check
          label={`Keep runs going in the ${trayName} when I close the window`}
          checked={settings.keepRunningInTray}
          disabled={!settings.showTray}
          onChange={(v) => set({ keepRunningInTray: v })}
        />
        <Check label="Keep the computer awake" checked={settings.preventSleep} onChange={(v) => set({ preventSleep: v })} />
      </Section>

      <Section
        title="Slack"
        description="Post long runs to a Slack channel through an incoming webhook, for when you are away from the computer. Only the flow name and the figures are sent, never inputs or outputs."
      >
        {data.webhookError ? <Banner tone="error">The last post failed. {data.webhookError}</Banner> : null}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            type="password"
            aria-label="Slack webhook URL"
            placeholder={data.webhookConfigured ? "A webhook URL is saved. Paste a new one to replace it." : "https://hooks.slack.com/services/…"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{ ...input, flex: 1 }}
          />
          <Button variant="primary" onClick={() => void saveUrl()} disabled={saving || !url.trim()}>
            Save
          </Button>
          {data.webhookConfigured ? (
            <Button onClick={() => void setWebhookUrl(null)} disabled={saving}>
              Remove
            </Button>
          ) : null}
        </div>
        <Check label="Post to Slack" checked={settings.webhook.enabled} disabled={!data.webhookConfigured} onChange={(v) => setWebhook({ enabled: v })} />
        <Check label="When a run finishes" checked={settings.webhook.runCompleted} disabled={!settings.webhook.enabled} onChange={(v) => setWebhook({ runCompleted: v })} />
        <Check label="When a run fails" checked={settings.webhook.runFailed} disabled={!settings.webhook.enabled} onChange={(v) => setWebhook({ runFailed: v })} />
        <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", color: settings.webhook.enabled ? theme.text : theme.textMuted }}>
          Only runs longer than
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.webhook.minDurationMinutes}
            disabled={!settings.webhook.enabled}
            onChange={(e) => setWebhook({ minDurationMinutes: Math.max(0, Math.min(1440, Math.round(Number(e.target.value) || 0))) })}
            style={{ ...input, width: 80 }}
          />
          minutes
        </label>
      </Section>
    </div>
  );
}
