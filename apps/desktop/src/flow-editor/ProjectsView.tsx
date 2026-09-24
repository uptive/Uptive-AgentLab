import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { FlowRecord } from "@agentlab/contracts";
import type { ProjectEntry, ProjectsState } from "../../electron/api.js";
import { theme, withAlpha } from "../theme.js";
import { bridge, errorMessage } from "./bridge.js";
import { STATUS_COLORS } from "./EditorContext.js";
import { slugify } from "./graphMapping.js";
import { buttonBase } from "./styles.js";

interface Props {
  onOpenLocal: (entry: ProjectEntry, content: string) => void;
  onOpenCloud: (record: FlowRecord) => void;
}

type Target = "local" | "cloud";

export function ProjectsView({ onOpenLocal, onOpenCloud }: Props) {
  const [state, setState] = useState<ProjectsState>();
  const [cloudFlows, setCloudFlows] = useState<FlowRecord[]>();
  const [error, setError] = useState<string>();
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState<Target>("local");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [projects, flows] = await Promise.all([bridge().projects.list(), bridge().cloudFlows.list()]);
      setState(projects);
      setCloudFlows(flows);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (action: () => Promise<void>) => {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const trimmed = newName || "Untitled flow";
      if (target === "local") {
        const { entry, content } = await bridge().projects.create(trimmed);
        setNewName("");
        setCreating(false);
        onOpenLocal(entry, content);
        return;
      }
      const taken = new Set((cloudFlows ?? []).map((f) => f.id));
      const base = slugify(trimmed);
      let id = base;
      for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
      const record = await bridge().cloudFlows.save({ id, name: trimmed, nodes: [] });
      setNewName("");
      setCreating(false);
      await refresh();
      onOpenCloud(record);
    });
  };

  const openLocal = (entry: ProjectEntry) =>
    run(async () => {
      onOpenLocal(entry, await bridge().flows.read(entry.filePath));
    });

  const openCloud = (record: FlowRecord) => run(async () => onOpenCloud(record));

  const add = () =>
    run(async () => {
      const added = await bridge().projects.add();
      await refresh();
      if (added.length === 1) await openLocal(added[0]);
    });

  const remove = (entry: ProjectEntry) =>
    run(async () => {
      if (!window.confirm(`Remove "${entry.name ?? fileName(entry.filePath)}" from the project list?\nThe file itself is not deleted.`)) return;
      await bridge().projects.remove(entry.filePath);
      await refresh();
    });

  const deleteCloud = (record: FlowRecord) =>
    run(async () => {
      if (!window.confirm(`Delete "${record.name}" from the database? This cannot be undone.`)) return;
      await bridge().cloudFlows.delete(record.id);
      await refresh();
    });

  const items: Item[] = [
    ...(state?.flows.map((entry): Item => ({ kind: "local", entry, sortKey: entry.lastOpenedAt ?? entry.modifiedAt ?? "" })) ?? []),
    ...(cloudFlows?.map((record): Item => ({ kind: "cloud", record, sortKey: record.updatedAt })) ?? []),
  ].sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  const loaded = state !== undefined && cloudFlows !== undefined;

  return (
    <div style={{ padding: 24, height: "100%", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <h1 style={{ margin: 0, marginRight: "auto" }}>Projects</h1>
        <button style={buttonBase} onClick={add}>
          Add existing…
        </button>
        <button
          style={{ ...buttonBase, background: theme.primary, color: theme.onPrimary, fontWeight: 600 }}
          onClick={() => {
            setTarget("local");
            setCreating(true);
          }}
        >
          + New flow
        </button>
      </div>
      <p style={{ margin: "0 0 16px", opacity: 0.6, fontSize: 13 }}>
        Local flows are stored in <code>{state?.flowsDirectory ?? "…"}</code>; cloud flows are saved to MongoDB.
      </p>

      {error ? <div style={{ ...banner, background: withAlpha(STATUS_COLORS.failed, 13), color: STATUS_COLORS.failed }}>{error}</div> : null}

      {creating ? (
        <form onSubmit={create} style={{ ...card, display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              autoFocus
              placeholder="Flow name, e.g. Code Review Flow"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
              style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.codeBg, color: theme.text, fontSize: 14 }}
            />
            <button type="submit" style={{ ...buttonBase, background: theme.primary, color: theme.onPrimary, fontWeight: 600 }}>
              Create
            </button>
            <button type="button" style={buttonBase} onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["local", "cloud"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTarget(t)}
                style={{
                  ...buttonBase,
                  padding: "4px 10px",
                  fontSize: 12,
                  background: target === t ? theme.primary : theme.codeBg,
                  color: target === t ? theme.onPrimary : theme.text,
                  fontWeight: target === t ? 600 : 400,
                }}
              >
                {t === "local" ? "Local file" : "Cloud (MongoDB)"}
              </button>
            ))}
          </div>
        </form>
      ) : null}

      {loaded && items.length === 0 && !creating ? (
        <div style={{ ...card, textAlign: "center", padding: 40, opacity: 0.8 }}>
          <p style={{ marginTop: 0 }}>No flows yet.</p>
          <button style={{ ...buttonBase, background: theme.primary, color: theme.onPrimary, fontWeight: 600 }} onClick={() => setCreating(true)}>
            Create your first flow
          </button>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {items.map((item) =>
          item.kind === "local" ? (
            <LocalCard key={`local:${item.entry.filePath}`} entry={item.entry} onOpen={openLocal} onRemove={remove} onReveal={(fp) => run(() => bridge().projects.reveal(fp))} />
          ) : (
            <CloudCard key={`cloud:${item.record.id}`} record={item.record} onOpen={openCloud} onDelete={deleteCloud} />
          ),
        )}
      </div>

      {state ? (
        <p style={{ marginTop: 24, fontSize: 11, opacity: 0.45 }}>
          Editor configuration: <code>{state.configPath}</code>
        </p>
      ) : null}
    </div>
  );
}

type Item = { kind: "local"; entry: ProjectEntry; sortKey: string } | { kind: "cloud"; record: FlowRecord; sortKey: string };

function LocalCard({
  entry,
  onOpen,
  onRemove,
  onReveal,
}: {
  entry: ProjectEntry;
  onOpen: (entry: ProjectEntry) => void;
  onRemove: (entry: ProjectEntry) => void;
  onReveal: (filePath: string) => void;
}) {
  const ok = entry.status === "ok";
  return (
    <div style={{ ...card, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.7 }} onClick={() => ok && onOpen(entry)} title={entry.filePath}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <strong style={{ fontSize: 15 }}>{entry.name ?? fileName(entry.filePath)}</strong>
        <Badge kind="local" />
      </div>
      {!ok ? <div style={{ color: STATUS_COLORS.failed, fontSize: 12, marginTop: 4 }}>{entry.status === "missing" ? "File missing" : "Invalid file"}</div> : null}
      {entry.description ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{entry.description}</div> : null}
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
        {ok ? `${entry.nodeCount} step${entry.nodeCount === 1 ? "" : "s"}` : null}
        {entry.modifiedAt ? ` · modified ${formatDate(entry.modifiedAt)}` : null}
      </div>
      <div style={{ fontSize: 11, opacity: 0.45, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.filePath}</div>
      <div style={{ display: "flex", gap: 12, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
        {ok ? (
          <button style={link} onClick={() => onOpen(entry)}>
            Open
          </button>
        ) : null}
        {entry.status !== "missing" ? (
          <button style={link} onClick={() => onReveal(entry.filePath)}>
            Show in folder
          </button>
        ) : null}
        <button style={{ ...link, color: STATUS_COLORS.failed, marginLeft: "auto" }} onClick={() => onRemove(entry)}>
          Remove
        </button>
      </div>
    </div>
  );
}

function CloudCard({ record, onOpen, onDelete }: { record: FlowRecord; onOpen: (record: FlowRecord) => void; onDelete: (record: FlowRecord) => void }) {
  return (
    <div style={{ ...card, cursor: "pointer" }} onClick={() => onOpen(record)} title={record.id}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <strong style={{ fontSize: 15 }}>{record.name}</strong>
        <Badge kind="cloud" />
      </div>
      {record.description ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{record.description}</div> : null}
      <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
        {record.nodes.length} step{record.nodes.length === 1 ? "" : "s"} · modified {formatDate(record.updatedAt)}
      </div>
      <div style={{ fontSize: 11, opacity: 0.45, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.id}</div>
      <div style={{ display: "flex", gap: 12, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
        <button style={link} onClick={() => onOpen(record)}>
          Open
        </button>
        <button style={{ ...link, color: STATUS_COLORS.failed, marginLeft: "auto" }} onClick={() => onDelete(record)}>
          Delete
        </button>
      </div>
    </div>
  );
}

function Badge({ kind }: { kind: Target }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "2px 6px",
        borderRadius: 4,
        color: kind === "cloud" ? theme.primary : theme.text,
        background: kind === "cloud" ? withAlpha(theme.primary, 13) : theme.border,
        whiteSpace: "nowrap",
      }}
    >
      {kind === "cloud" ? "Cloud" : "Local"}
    </span>
  );
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const card: CSSProperties = { padding: 14, borderRadius: 10, background: theme.surface, border: `1px solid ${theme.border}`, boxShadow: theme.cardShadow };
const banner: CSSProperties = { padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 };
const link: CSSProperties = { background: "none", border: "none", padding: 0, color: theme.primary, cursor: "pointer", fontSize: 12 };
