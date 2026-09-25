// Pure helpers behind ReadableValue, kept apart so they can be tested without the DOM.

/** "file_path" / "filePath" -> "File path". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Tool results often arrive as content blocks ([{ type: "text", text }]); join them into text. */
export function contentBlocksText(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const texts: string[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return undefined;
    const block = item as { type?: unknown; text?: unknown };
    if (block.type !== "text" || typeof block.text !== "string") return undefined;
    texts.push(block.text);
  }
  return texts.join("\n");
}
