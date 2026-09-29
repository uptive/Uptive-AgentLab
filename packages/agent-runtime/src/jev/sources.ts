import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_SOURCE_FILES = 50;
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;
export const MAX_SOURCE_TOTAL_BYTES = 1024 * 1024;

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules"]);

/** Throws when a pattern could reach outside the run folder. */
export function validateSourcePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.trim() === "") throw new Error("Jev source pattern must not be empty");
  if (path.isAbsolute(pattern) || /^[A-Za-z]:[\\/]/.test(pattern)) throw new Error(`Jev source pattern "${pattern}" must be relative to the run folder`);
  const segments = pattern.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) throw new Error(`Jev source pattern "${pattern}" must not contain ".."`);
}

function segmentRegex(segment: string): string {
  let out = "";
  for (const char of segment) {
    if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return out;
}

/** Compiles a glob supporting `*`, `?` and `**` into an anchored regex over POSIX relative paths. */
export function compileSourcePattern(pattern: string): RegExp {
  const segments = pattern.replace(/\\/g, "/").split("/").filter((segment) => segment !== "" && segment !== ".");
  let source = "";
  for (const [index, segment] of segments.entries()) {
    const last = index === segments.length - 1;
    if (segment === "**") {
      source += last ? "(?:[^/]+/)*[^/]+" : "(?:[^/]+/)*";
      continue;
    }
    source += segmentRegex(segment) + (last ? "" : "/");
  }
  return new RegExp(`^${source}$`);
}

async function walk(folder: string, relative: string, found: string[]): Promise<void> {
  const entries = await readdir(path.join(folder, relative), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(folder, child, found);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      found.push(child);
    }
  }
}

function isBinary(contents: Buffer): boolean {
  const sample = contents.subarray(0, 8192);
  if (sample.includes(0)) return true;
  return !sample.equals(Buffer.from(sample.toString("utf8"), "utf8"));
}

export interface SourceFiles {
  [relativePath: string]: string;
}

/**
 * Reads every file under `folder` matching one of `patterns`. Read-only, never leaves the folder,
 * and throws rather than truncating when a cap is exceeded. Binary files are skipped.
 */
export async function readSourceFiles(folder: string, patterns: string[]): Promise<SourceFiles> {
  for (const pattern of patterns) validateSourcePattern(pattern);
  if (patterns.length === 0) return {};
  if (!(await stat(folder).then((entry) => entry.isDirectory(), () => false))) throw new Error(`Jev source folder not found: ${folder}`);

  const root = await realpath(folder);
  const regexes = patterns.map((pattern) => compileSourcePattern(pattern));
  const candidates: string[] = [];
  await walk(root, "", candidates);
  const matched = candidates.filter((relative) => regexes.some((regex) => regex.test(relative)));

  const files: SourceFiles = {};
  let total = 0;
  let count = 0;
  for (const relative of matched) {
    const absolute = await realpath(path.join(root, relative)).catch(() => undefined);
    if (!absolute) continue;
    if (absolute !== root && !absolute.startsWith(root + path.sep)) {
      throw new Error(`Jev source "${relative}" resolves outside the run folder`);
    }
    const contents = await readFile(absolute);
    if (isBinary(contents)) continue;
    if (contents.byteLength > MAX_SOURCE_FILE_BYTES) {
      throw new Error(`Jev source "${relative}" is ${contents.byteLength} bytes, over the ${MAX_SOURCE_FILE_BYTES} byte limit for a single file`);
    }
    count += 1;
    if (count > MAX_SOURCE_FILES) throw new Error(`Jev sources match more than ${MAX_SOURCE_FILES} files; narrow the patterns`);
    total += contents.byteLength;
    if (total > MAX_SOURCE_TOTAL_BYTES) throw new Error(`Jev sources exceed the ${MAX_SOURCE_TOTAL_BYTES} byte total limit; narrow the patterns`);
    files[relative] = contents.toString("utf8");
  }
  return files;
}
