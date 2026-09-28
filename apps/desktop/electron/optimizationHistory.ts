// Node-only: finished Optimize analyses, one JSON file each in <userData>/optimizations. They hold
// the analyzed run's inputs and outputs, so they stay on this computer like the runs themselves.
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { SavedOptimization, SavedOptimizationSummary } from "@agentlab/optimization";
import { IPC } from "./api.js";
import type { Handle } from "./ipcHandle.js";

/** How many optimizations the list shows, newest first. */
export const RECENT_OPTIMIZATIONS = 20;

/** Ids become file names, so only this shape is accepted. */
export const OptimizationIdSchema = z.string().regex(/^opt_[A-Za-z0-9_-]{1,80}$/, "Invalid optimization id");

const SummarySchema = z.object({
  id: OptimizationIdSchema,
  createdAt: z.iso.datetime(),
  runId: z.string(),
  flowName: z.string(),
  modelIds: z.array(z.string()),
  recommendations: z.number(),
  highSeverity: z.number(),
  savedUsdPerRun: z.number(),
  applied: z.number(),
});

/**
 * The envelope of a saved optimization. The analyses and input are checked for the fields the
 * Optimize view needs to reopen them; their contents came from this app's own evaluators.
 */
export const SavedOptimizationSchema = z.object({
  summary: SummarySchema,
  input: z.looseObject({
    run: z.looseObject({ id: z.string(), steps: z.array(z.unknown()) }),
    flow: z.looseObject({ id: z.string(), nodes: z.array(z.unknown()) }),
    agents: z.array(z.unknown()),
  }),
  analyses: z.array(z.looseObject({ modelId: z.string(), calls: z.array(z.unknown()), durationMs: z.number() })).min(1),
  analyzedWith: z.string(),
  appliedKeys: z.array(z.string()),
  edits: z.array(z.tuple([z.string(), z.unknown()])),
});

export interface RecentOptimizations {
  /** Newest first, at most RECENT_OPTIMIZATIONS. */
  items: SavedOptimizationSummary[];
  /** Files among the most recent that couldn't be read, and why. */
  unreadable: { file: string; reason: string }[];
}

export interface OptimizationHistory {
  /** Saves (or replaces) one optimization, as validated by SavedOptimizationSchema. */
  save(record: z.output<typeof SavedOptimizationSchema>): Promise<void>;
  listRecent(): Promise<RecentOptimizations>;
  get(id: string): Promise<SavedOptimization | undefined>;
}

// Names start with the creation time, so sorting file names sorts by age without opening them.
const fileName = (summary: SavedOptimizationSummary) => `${summary.createdAt.replace(/[:.]/g, "-")}_${summary.id}.json`;
const idOf = (name: string) => /_(opt_[A-Za-z0-9_-]+)\.json$/.exec(name)?.[1];

export function createOptimizationHistory(dir: string): OptimizationHistory {
  let queue: Promise<unknown> = Promise.resolve();

  async function names(): Promise<string[]> {
    try {
      return (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && idOf(n)).sort().reverse();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async function read(name: string): Promise<SavedOptimization> {
    const text = await fs.readFile(path.join(dir, name), "utf8");
    const parsed = SavedOptimizationSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`${name} is not a valid saved optimization: ${z.prettifyError(parsed.error)}`);
    // Validated above for everything the view relies on; the rest is this app's own evaluator output.
    return parsed.data as unknown as SavedOptimization;
  }

  return {
    save(record) {
      const next = queue.then(async () => {
        await fs.mkdir(dir, { recursive: true });
        const target = path.join(dir, fileName(record.summary));
        await fs.writeFile(`${target}.tmp`, JSON.stringify(record), "utf8");
        await fs.rename(`${target}.tmp`, target);
      });
      queue = next.catch(() => undefined);
      return next;
    },
    async listRecent() {
      const result: RecentOptimizations = { items: [], unreadable: [] };
      // One unreadable file shouldn't hide the others; it is reported next to them instead.
      for (const name of (await names()).slice(0, RECENT_OPTIMIZATIONS)) {
        try {
          result.items.push((await read(name)).summary);
        } catch (error) {
          result.unreadable.push({ file: name, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      return result;
    },
    async get(id) {
      const name = (await names()).find((n) => idOf(n) === id);
      return name ? read(name) : undefined;
    },
  };
}

/** Optimize saves each finished analysis here, lists the recent ones and reopens them. */
export function registerOptimizationHistoryIpc(handle: Handle, history: OptimizationHistory) {
  handle(IPC.saveOptimization, z.tuple([SavedOptimizationSchema]), ([record]) => history.save(record));
  handle(IPC.listOptimizations, z.tuple([]), () => history.listRecent());
  handle(IPC.getOptimization, z.tuple([OptimizationIdSchema]), ([id]) => history.get(id));
}
