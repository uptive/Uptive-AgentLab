import { useEffect, useState } from "react";
import type { FlowDefinition } from "@agentlab/contracts";
import { serializeFlow } from "@agentlab/flow-engine";
import { colors } from "../theme.js";
import { STATUS_COLORS } from "../flow-editor/EditorContext.js";
import { deleteFlow, listFlows, saveFlow, type FlowSummary } from "../flow-editor/fileIO.js";
import { slugify, uniqueNodeId } from "../flow-editor/graphMapping.js";
import { buttonBase } from "../flow-editor/Inspector.js";

interface Props {
  onOpen: (flowId: string) => void;
}

export function FlowsListView({ onOpen }: Props) {
  const [flows, setFlows] = useState<FlowSummary[] | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setFlows(await listFlows());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createFlow = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const existingIds = (flows ?? []).map((f) => f.id);
      const id = uniqueNodeId(slugify("untitled-flow"), existingIds);
      const flow: FlowDefinition = { id, name: "Untitled flow", nodes: [] };
      await saveFlow(id, serializeFlow(flow));
      onOpen(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const removeFlow = async (id: string) => {
    if (!window.confirm(`Delete flow "${id}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteFlow(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ height: "100%", overflow: "auto", boxSizing: "border-box", padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 16, gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: 20, flex: 1 }}>Flows</h1>
        <button
          style={{ ...buttonBase, background: colors.accent, color: colors.bgBlack, fontWeight: 600 }}
          onClick={createFlow}
          disabled={busy}
        >
          + New flow
        </button>
      </div>

      {error ? (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 12,
            marginBottom: 12,
            background: `${STATUS_COLORS.failed}22`,
            color: STATUS_COLORS.failed,
          }}
        >
          {error}
        </div>
      ) : null}

      {flows === undefined ? (
        <p style={{ opacity: 0.6 }}>Loading…</p>
      ) : flows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No flows yet. Create one to get started.</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {flows.map((flow) => (
            <div
              key={flow.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderRadius: 8,
                border: `1px solid ${colors.bgCard}`,
                background: colors.bgGrey,
              }}
            >
              <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => onOpen(flow.id)}>
                <div style={{ fontWeight: 600 }}>{flow.name}</div>
                <div style={{ fontSize: 11, opacity: 0.55 }}>
                  {flow.id} · updated {new Date(flow.updatedAt).toLocaleString()}
                </div>
                {flow.description ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{flow.description}</div> : null}
              </div>
              <button style={buttonBase} onClick={() => onOpen(flow.id)} disabled={busy}>
                Open
              </button>
              <button
                style={{ ...buttonBase, background: "transparent", color: STATUS_COLORS.failed, border: `1px solid ${STATUS_COLORS.failed}` }}
                onClick={() => removeFlow(flow.id)}
                disabled={busy}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
