import { BrowserWindow } from "electron";
import { execFile, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import { checkSoundFile, extensionOf, MIME } from "./soundFile.js";

// Plays a user-chosen notification sound. Notifications cannot play arbitrary files themselves
// (macOS only takes named system sounds, Windows toasts only ms-winsoundevent), so the
// notification is shown silent and the file is played here: with afplay on macOS, which also
// handles the system .aiff sounds, and in a hidden sandboxed page elsewhere.

/** Longer files are cut off; a notification sound should be a second or two. */
const MAX_PLAY_MS = 15_000;

export class SoundPlayer {
  private playing: ChildProcess | BrowserWindow | undefined;

  /** Resolves when the sound has played; rejects when the file is missing or cannot be decoded. */
  async play(file: string): Promise<void> {
    await checkSoundFile(file);
    this.stop(); // a new sound replaces one still playing
    if (process.platform === "darwin") return this.playWithAfplay(file);
    return this.playInPage(file);
  }

  private playWithAfplay(file: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile("afplay", [file], { timeout: MAX_PLAY_MS }, (error) => {
        if (this.playing === child) this.playing = undefined;
        // Killed by the timeout or by a newer sound: that is not a failure.
        if (error && !child.killed) reject(new Error(`The sound could not be played: ${error.message}`));
        else resolve();
      });
      this.playing = child;
    });
  }

  private async playInPage(file: string): Promise<void> {
    const mime = MIME[extensionOf(file)];
    const data = (await readFile(file)).toString("base64");
    // No preload and a blank page: it gets nothing but the bytes. Destroyed after playing, so it never
    // keeps the app alive or shows up as a window.
    const win = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
    });
    this.playing = win;
    try {
      await win.loadURL("about:blank");
      await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
        const audio = new Audio(${JSON.stringify(`data:${mime};base64,${data}`)});
        audio.onended = () => resolve();
        audio.onerror = () => reject(new Error("the file could not be decoded"));
        setTimeout(resolve, ${MAX_PLAY_MS});
        audio.play().catch(reject);
      })`);
    } catch (error) {
      if (!win.isDestroyed()) throw new Error(`The sound could not be played: ${(error as Error).message}`);
    } finally {
      if (this.playing === win) this.playing = undefined;
      if (!win.isDestroyed()) win.destroy();
    }
  }

  stop(): void {
    const playing = this.playing;
    this.playing = undefined;
    if (playing instanceof BrowserWindow) {
      if (!playing.isDestroyed()) playing.destroy();
    } else playing?.kill();
  }
}
