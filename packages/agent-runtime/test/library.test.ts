import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMcpServerFileStore, createSkillFileStore, parseSkillFile, renderSkillFile } from "../src/library.js";

describe("skill files", () => {
  it("round-trips descriptions with colons and newlines", () => {
    const skill = { name: "brand-voice", description: 'Use for copy: headlines, "CTAs"\nand emails.', instructions: "# Voice\nWarm." };
    expect(parseSkillFile("brand-voice", renderSkillFile(skill))).toEqual(skill);
  });

  it("reads hand-written SKILL.md files with plain YAML values", () => {
    const parsed = parseSkillFile("x", "---\nname: pdf\ndescription: Work with PDF files\n---\nBody");
    expect(parsed).toEqual({ name: "pdf", description: "Work with PDF files", instructions: "Body" });
  });

  it("saves, lists and deletes skills, rejecting invalid names", async () => {
    const store = createSkillFileStore(await mkdtemp(path.join(tmpdir(), "skills-")));
    await store.save({ name: "tone", description: "Use when writing.", instructions: "Be kind." });
    await mkdir(path.join(store.dir, "Not Valid"));
    expect((await store.list()).map((s) => s.name)).toEqual(["tone"]);
    await expect(store.save({ name: "Bad Name", description: "d", instructions: "i" })).rejects.toThrow(/lowercase/);
    await expect(store.save({ name: "empty", description: " ", instructions: "i" })).rejects.toThrow(/description/);
    expect(await store.delete("tone")).toBe(true);
    expect(await store.list()).toEqual([]);
  });
});

describe("MCP server files", () => {
  it("saves servers, keeps createdAt, and skips invalid files", async () => {
    const store = createMcpServerFileStore(await mkdtemp(path.join(tmpdir(), "mcp-")));
    const first = await store.save({ id: "figma", name: "Figma", transport: { type: "http", url: "https://mcp.figma.com/mcp" } });
    const second = await store.save({ ...first, name: "Figma Dev Mode" });
    expect(second.createdAt).toBe(first.createdAt);
    await writeFile(path.join(store.dir, "broken.json"), "{");
    expect((await store.list()).map((s) => s.name)).toEqual(["Figma Dev Mode"]);
  });

  it("rejects plain http except for localhost", async () => {
    const store = createMcpServerFileStore(await mkdtemp(path.join(tmpdir(), "mcp-")));
    await expect(store.save({ id: "x", name: "X", transport: { type: "http", url: "http://example.com/mcp" } })).rejects.toThrow(/https/);
    await expect(store.save({ id: "local", name: "Local", transport: { type: "http", url: "http://localhost:3000/mcp" } })).resolves.toBeTruthy();
  });
});
