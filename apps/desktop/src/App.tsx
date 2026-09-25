import { useEffect, useState } from "react";
import { AgentsView } from "./views/AgentsView.js";
import { FlowsView } from "./views/FlowsView.js";
import { RunsView } from "./views/RunsView.js";
import { OptimizeView } from "./views/OptimizeView.js";
import { LibraryView } from "./views/LibraryView.js";
import { AuthStatus } from "./AuthStatus.js";
import { McpView } from "./views/McpView.js";
import { SetupView } from "./views/SetupView.js";
import { NotificationsView } from "./notifications/NotificationsView.js";
import { notificationsBridge, requestOpenRun } from "./notifications/bridge.js";
import { Banner } from "./ui/Banner.js";
import { theme, useTheme } from "./theme.js";
import { useActiveRunCount } from "./runs/runUi.js";

const TABS = [
  { id: "agents", label: "Agents", view: AgentsView, fullBleed: false },
  { id: "flows", label: "Flows", view: FlowsView, fullBleed: true },
  { id: "runs", label: "Runs", view: RunsView, fullBleed: false },
  { id: "optimize", label: "Optimize", view: OptimizeView, fullBleed: false },
  { id: "library", label: "Tools & skills", view: LibraryView, fullBleed: false },
  { id: "mcp", label: "MCP", view: McpView, fullBleed: false },
  { id: "setup", label: "Setup", view: SetupView, fullBleed: false },
  { id: "notifications", label: "Notifications", view: NotificationsView, fullBleed: false },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [activeTab, setActiveTab] = useState<TabId>("agents");

  // Views can ask to switch tabs, e.g. the agent editor's "Connect one" link.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (TABS.some((tab) => tab.id === id)) setActiveTab(id as TabId);
    };
    window.addEventListener("agentlab:navigate", onNavigate);
    return () => window.removeEventListener("agentlab:navigate", onNavigate);
  }, []);
  // A notification or tray item was clicked: main holds what to open until the app asks for it.
  const [openError, setOpenError] = useState<string>();
  useEffect(() => {
    const bridge = notificationsBridge();
    if (!bridge) return;
    let cancelled = false;
    const take = () =>
      bridge
        .takeOpenTarget()
        .then((target) => {
          if (cancelled || !target) return;
          if (target.view === "runs") requestOpenRun(target.runId);
          setActiveTab(target.view);
        })
        .catch((error: Error) => setOpenError(`Could not open what the notification pointed to: ${error.message}`));
    void take();
    const unsubscribe = bridge.onOpen(() => void take());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const { view: ActiveView, fullBleed } = TABS.find((tab) => tab.id === activeTab)!;
  const { mode, toggle } = useTheme();
  const activeRuns = useActiveRunCount();

  return (
    <div style={{ display: "flex", height: "100vh", background: theme.pageBg, color: theme.text }}>
      <nav
        style={{
          width: 160,
          display: "flex",
          flexDirection: "column",
          padding: 8,
          borderRight: `1px solid ${theme.border}`,
          background: theme.sidebarBg,
        }}
      >
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
              background: activeTab === tab.id ? theme.navActiveBg : "transparent",
              color: activeTab === tab.id ? theme.navActiveText : theme.text,
              fontWeight: activeTab === tab.id ? 600 : 400,
              cursor: "pointer",
            }}
          >
            {tab.label}
            {tab.id === "runs" && activeRuns > 0 ? (
              <span
                title={`${activeRuns} running`}
                style={{
                  marginLeft: 8,
                  padding: "0 7px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  background: theme.warning,
                  color: theme.onStatus,
                }}
              >
                ● {activeRuns}
              </span>
            ) : null}
          </button>
        ))}
        <AuthStatus />
        <button
          onClick={toggle}
          aria-label={`Switch to ${mode === "dark" ? "light" : "dark"} mode`}
          style={{
            padding: "8px 12px",
            border: `1px solid ${theme.border}`,
            borderRadius: 999,
            background: "transparent",
            color: theme.textSecondary,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </nav>
      <main style={{ flex: 1, minWidth: 0, padding: fullBleed ? 0 : 24, overflow: fullBleed ? "hidden" : "auto" }}>
        {openError ? <Banner tone="error" onDismiss={() => setOpenError(undefined)}>{openError}</Banner> : null}
        <ActiveView />
      </main>
    </div>
  );
}
