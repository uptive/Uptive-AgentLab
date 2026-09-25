import { mkdir, mkdtemp, truncate, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_NOTIFICATION_SETTINGS, NotificationSettingsSchema } from "../electron/notificationSettings.js";
import { checkSoundFile, MAX_SOUND_BYTES, soundExtensions } from "../electron/soundFile.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "agentlab-sound-"));
  await writeFile(path.join(dir, "ding.wav"), "RIFF");
  await writeFile(path.join(dir, "Glass.aiff"), "FORM");
  await mkdir(path.join(dir, "folder.wav"));
  await writeFile(path.join(dir, "big.mp3"), "");
  await truncate(path.join(dir, "big.mp3"), MAX_SOUND_BYTES + 1);
});

describe("checkSoundFile", () => {
  it("accepts a playable file", async () => {
    await expect(checkSoundFile(path.join(dir, "ding.wav"), "win32")).resolves.toBeUndefined();
  });

  it("allows the macOS system .aiff sounds only on macOS, where afplay plays them", async () => {
    await expect(checkSoundFile(path.join(dir, "Glass.aiff"), "darwin")).resolves.toBeUndefined();
    await expect(checkSoundFile(path.join(dir, "Glass.aiff"), "win32")).rejects.toThrow(/Pick a/);
    expect(soundExtensions("darwin")).toContain("aiff");
  });

  it("rejects relative paths, missing files, folders and oversized files", async () => {
    await expect(checkSoundFile("ding.wav", "win32")).rejects.toThrow(/absolute/);
    await expect(checkSoundFile(path.join(dir, "gone.wav"), "win32")).rejects.toThrow(/no longer exists/);
    await expect(checkSoundFile(path.join(dir, "folder.wav"), "win32")).rejects.toThrow(/not a file/);
    await expect(checkSoundFile(path.join(dir, "big.mp3"), "win32")).rejects.toThrow(/larger than 10 MB/);
  });
});

describe("soundFile setting", () => {
  it("defaults to the system sound, also for settings files saved before it existed", () => {
    expect(DEFAULT_NOTIFICATION_SETTINGS.soundFile).toBeNull();
    expect(NotificationSettingsSchema.parse({ sound: true }).soundFile).toBeNull();
  });
});
