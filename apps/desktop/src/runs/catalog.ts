import { useEffect, useMemo, useState } from "react";
import type { AgentDefinition, FlowDefinition } from "@agentlab/contracts";
import { parseFlow } from "@agentlab/flow-engine";
import type { AgentLabApi } from "../../electron/api.js";

// Absent in a plain browser preview; the catalog is then empty.
const bridge = (): AgentLabApi | undefined => (window as { agentlab?: AgentLabApi }).agentlab;

export interface FlowOption {
  flow: FlowDefinition;
  /** Where the flow came from, shown next to its name. */
  source: string;
}

export interface Catalog {
  flows: FlowOption[];
  agents: AgentDefinition[];
  agentsById: Map<string, AgentDefinition>;
  loading: boolean;
}

/** Everything a run can be started from: the flows saved in projects or MongoDB, and the stored agents. */
export function useCatalog(): Catalog {
  const [projectFlows, setProjectFlows] = useState<FlowOption[]>([]);
  const [storedAgents, setStoredAgents] = useState<AgentDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const api = bridge();
    if (!api) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const loadFlows = async () => {
      const { flows } = await api.projects.list();
      const loaded = await Promise.all(
        flows
          .filter((entry) => entry.status === "ok")
          .map(async (entry) => {
            try {
              return { flow: parseFlow(await api.flows.read(entry.filePath)), source: "project" };
            } catch {
              return undefined;
            }
          }),
      );
      // Flows saved to MongoDB; skipped when the database is unreachable.
      const cloud = await api.cloudFlows.list().catch(() => []);
      return [
        ...loaded.filter((option): option is FlowOption => option !== undefined),
        ...cloud.map(({ createdAt: _c, updatedAt: _u, ...flow }) => ({ flow, source: "cloud" })),
      ];
    };
    void Promise.allSettled([loadFlows(), api.agents.list()]).then(([flows, agents]) => {
      if (cancelled) return;
      if (flows.status === "fulfilled") setProjectFlows(flows.value);
      if (agents.status === "fulfilled") setStoredAgents(agents.value);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => {
    const agentsById = new Map(storedAgents.map((agent) => [agent.id, agent]));
    return { flows: projectFlows, agents: Array.from(agentsById.values()), agentsById, loading };
  }, [projectFlows, storedAgents, loading]);
}
