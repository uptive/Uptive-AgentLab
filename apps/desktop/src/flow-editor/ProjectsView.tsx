import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import type { ProjectEntry, ProjectsState } from "../../electron/api.js";
import { colors } from "../theme.js";
import { bridge, errorMessage } from "./bridge.js";
import { STATUS_COLORS } from "./EditorContext.js";
import { buttonBase } from "./styles.js";

interface Props {
  onOpen: (entry: ProjectEntry, content: string) => void;
}

export function ProjectsView({ onOpen }: Props) {
  const [state, setState] = useState<ProjectsState>();
  const [error, setError] = useState<string>();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await bridge().projects.list());
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
      const { entry, content } = await bridge().projects.create(newName || "Untitled flow");
      setNewName("");
      setCreating(false);
      onOpen(entry, content);
    });
  };

  const open = (entry: ProjectEntry) =>
    run(async () => {
      onOpen(entry, await bridge().flows.read(entry.filePath));
    });

  const add = () =>
    run(async () => {
      const added = await bridge().projects.add();
      await refresh();
      if (added.length === 1) await open(added[0]);
    });

  const remove = (entry: ProjectEntry) =>
    run(async () => {
      if (!window.confirm(`Remove "${entry.name ?? fileName(entry.filePath)}" from the project list?\nThe file itself is not deleted.`)) return;
      await bridge().projects.remove(entry.filePath);
      await refresh();
    });

  return (
    <div style={{ padding: 24, height: "100%", boxSizing: "border-box", overflowY: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <h1 style={{ margin: 0, marginRight: "auto" }}>Projects</h1>
        <button style={buttonBase} onClick={add}>
          Add existing…
        </button>
        <button style={{ ...buttonBase, background: colors.accent, color: colors.bgBlack, fontWeight: 600 }} onClick={() => setCreating(true)}>
          + New flow
        </button>
      </div>
      <p style={{ margin: "0 0 16px", opacity: 0.6, fontSize: 13 }}>
        Your saved flow definitions. New flows are stored in <code>{state?.flowsDirectory ?? "…"}</code>.
      </p>

      {error ? <div style={{ ...banner, background: `${STATUS_COLORS.failed}22`, color: STATUS_COLORS.failed }}>{error}</div> : null}

      {creating ? (
        <form onSubmit={create} style={{ ...card, display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <input
            autoFocus
            placeholder="Flow name, e.g. Code Review Flow"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setCreating(false)}
            style={{ flex: 1, padding: "8px 10px", borderRadius: 6, border: `1px solid ${colors.bgCard}`, background: colors.bgBlack, color: colors.secondary, fontSize: 14 }}
          />
          <button type="submit" style={{ ...buttonBase, background: colors.accent, color: colors.bgBlack, fontWeight: 600 }}>
            Create
          </button>
          <button type="button" style={buttonBase} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </form>
      ) : null}

      {state && state.flows.length === 0 && !creating ? (
        <div style={{ ...card, textAlign: "center", padding: 40, opacity: 0.8 }}>
          <p style={{ marginTop: 0 }}>No flows yet.</p>
          <button style={{ ...buttonBase, background: colors.accent, color: colors.bgBlack, fontWeight: 600 }} onClick={() => setCreating(true)}>
            Create your first flow
          </button>
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {state?.flows.map((entry) => {
          const ok = entry.status === "ok";
          return (
            <div
              key={entry.filePath}
              style={{ ...card, cursor: ok ? "pointer" : "default", opacity: ok ? 1 : 0.7 }}
              onClick={() => ok && void open(entry)}
              title={entry.filePath}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <strong style={{ fontSize: 15 }}>{entry.name ?? fileName(entry.filePath)}</strong>
                {!ok ? <span style={{ color: STATUS_COLORS.failed, fontSize: 12 }}>{entry.status === "missing" ? "File missing" : "Invalid file"}</span> : null}
              </div>
              {entry.description ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{entry.description}</div> : null}
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
                {ok ? `${entry.nodeCount} step${entry.nodeCount === 1 ? "" : "s"}` : null}
                {entry.modifiedAt ? ` · modified ${formatDate(entry.modifiedAt)}` : null}
              </div>
              <div style={{ fontSize: 11, opacity: 0.45, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.filePath}
              </div>
              <div style={{ display: "flex", gap: 12, marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                {ok ? (
                  <button style={link} onClick={() => void open(entry)}>
                    Open
                  </button>
                ) : null}
                {entry.status !== "missing" ? (
                  <button style={link} onClick={() => void run(() => bridge().projects.reveal(entry.filePath))}>
                    Show in folder
                  </button>
                ) : null}
                <button style={{ ...link, color: STATUS_COLORS.failed, marginLeft: "auto" }} onClick={() => void remove(entry)}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {state ? (
        <p style={{ marginTop: 24, fontSize: 11, opacity: 0.45 }}>
          Editor configuration: <code>{state.configPath}</code>
        </p>
      ) : null}
    </div>
  );
}

const fileName = (p: string) => p.split(/[\\/]/).pop() ?? p;
const formatDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const card: CSSProperties = { padding: 14, borderRadius: 10, background: colors.bgGrey, border: `1px solid ${colors.bgCard}` };
const banner: CSSProperties = { padding: "8px 12px", borderRadius: 6, marginBottom: 12, fontSize: 13 };
const link: CSSProperties = { background: "none", border: "none", padding: 0, color: colors.accent, cursor: "pointer", fontSize: 12 };
