import { stat } from "node:fs/promises";
import path from "node:path";

// Which files can be notification sounds. Kept free of Electron so it can be unit tested.

export const MAX_SOUND_BYTES = 10 * 1024 * 1024;
export const MIME: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

/** What the player can play: afplay formats on macOS, Chromium's elsewhere. */
export const soundExtensions = (platform: NodeJS.Platform = process.platform) =>
  platform === "darwin" ? ["aiff", "aif", "caf", "wav", "mp3", "m4a", "aac"] : Object.keys(MIME);

export const extensionOf = (file: string) => path.extname(file).slice(1).toLowerCase();

/** Throws a message fit for the user when the file cannot be used as a notification sound. */
export async function checkSoundFile(file: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  if (!path.isAbsolute(file)) throw new Error("The sound file path must be absolute");
  const extensions = soundExtensions(platform);
  if (!extensions.includes(extensionOf(file))) throw new Error(`Pick a ${extensions.join(", ")} file`);
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    throw new Error(error.code === "ENOENT" ? `${file} no longer exists` : `${file} cannot be read: ${error.message}`);
  });
  if (!info.isFile()) throw new Error(`${file} is not a file`);
  if (info.size > MAX_SOUND_BYTES) throw new Error(`The sound file is larger than ${MAX_SOUND_BYTES / 1024 / 1024} MB`);
}
