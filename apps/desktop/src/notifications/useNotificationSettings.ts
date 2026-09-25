import { useCallback, useEffect, useRef, useState } from "react";
import type { NotificationSettings, NotificationStatus, NotificationTestResult } from "../../electron/api.js";
import { notificationsBridge } from "./bridge.js";

const message = (error: unknown) => (error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(error));

/** Notification settings and webhook state from the main process, kept live through its status pushes. */
export function useNotificationSettings() {
  const [data, setData] = useState<NotificationStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // Only the latest request may update state, so a slow save never overwrites a newer one.
  const request = useRef(0);

  useEffect(() => {
    const bridge = notificationsBridge();
    if (!bridge) {
      setLoading(false);
      setError("Notifications are only available in the desktop app.");
      return;
    }
    let cancelled = false;
    bridge
      .status()
      .then((status) => !cancelled && setData(status))
      .catch((e: unknown) => !cancelled && setError(message(e)))
      .finally(() => !cancelled && setLoading(false));
    const unsubscribe = bridge.onStatus((status) => !cancelled && setData(status));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const run = useCallback(async <T,>(action: (bridge: NonNullable<ReturnType<typeof notificationsBridge>>) => Promise<T>): Promise<T | undefined> => {
    const bridge = notificationsBridge();
    if (!bridge) return undefined;
    const id = ++request.current;
    setSaving(true);
    setError(undefined);
    try {
      return await action(bridge);
    } catch (e) {
      if (id === request.current) setError(message(e));
      return undefined;
    } finally {
      if (id === request.current) setSaving(false);
    }
  }, []);

  const save = useCallback(
    (settings: NotificationSettings) =>
      run(async (bridge) => {
        setData((current) => current && { ...current, settings }); // show the change right away
        try {
          setData(await bridge.save(settings));
        } catch (e) {
          setData(await bridge.status()); // undo the optimistic change
          throw e;
        }
      }),
    [run],
  );

  const setWebhookUrl = useCallback((url: string | null) => run(async (bridge) => setData(await bridge.setWebhookUrl(url))), [run]);

  const pickSoundFile = useCallback(() => run(async (bridge) => setData(await bridge.pickSoundFile())), [run]);
  const clearSoundFile = useCallback(() => run(async (bridge) => setData(await bridge.clearSoundFile())), [run]);
  const previewSound = useCallback(() => run((bridge) => bridge.previewSound()), [run]);

  const sendTest = useCallback((): Promise<NotificationTestResult | undefined> => run((bridge) => bridge.sendTest()), [run]);

  return { data, loading, error, saving, save, setWebhookUrl, sendTest, pickSoundFile, clearSoundFile, previewSound, clearError: () => setError(undefined) };
}
