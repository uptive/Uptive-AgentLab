/** Throws when a pattern could reach outside the run folder. */
export function validateSourcePattern(pattern: string): void {
  if (typeof pattern !== "string" || pattern.trim() === "") throw new Error("Jev source pattern must not be empty");
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(pattern)) {
    throw new Error(`Jev source pattern "${pattern}" must be relative to the run folder`);
  }
  const segments = pattern.replace(/\\/g, "/").split("/");
  if (segments.includes("..")) throw new Error(`Jev source pattern "${pattern}" must not contain ".."`);
}
