import { useState } from "react";
import { AgentsView } from "./views/AgentsView.js";
import { FlowsView } from "./views/FlowsView.js";
import { RunsView } from "./views/RunsView.js";
import { OptimizeView } from "./views/OptimizeView.js";
import { colors } from "./theme.js";

const TABS = [
  { id: "agents", label: "Agents", view: AgentsView },
  { id: "flows", label: "Flows", view: FlowsView },
  { id: "runs", label: "Runs", view: RunsView },
  { id: "optimize", label: "Optimize", view: OptimizeView },
] as const;

export function App() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("agents");
  const ActiveView = TABS.find((tab) => tab.id === activeTab)!.view;

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: colors.bgBlack,
        color: colors.secondary,
      }}
    >
      <nav style={{ width: 160, borderRight: `1px solid ${colors.bgGrey}`, padding: 8, background: colors.bgGrey }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              marginBottom: 4,
              border: "none",
              borderRadius: 6,
              background: activeTab === tab.id ? colors.accent : "transparent",
              color: activeTab === tab.id ? colors.bgBlack : colors.secondary,
              fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24, overflow: "auto" }}>
        <ActiveView />
      </main>
    </div>
  );
}
