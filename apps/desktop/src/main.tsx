import React from "react";
import ReactDOM from "react-dom/client";
import { initTelemetryStore } from "@agentlab/observability";
import { App } from "./App.js";
import { connectLiveRuns } from "./liveRuns.js";
import { telemetryPersistence } from "./runsPersistence.js";
import "./theme.css";
import { initTheme } from "./theme.js";

initTheme();

// Bootstrap the shared telemetry store before any group's runtime records events.
initTelemetryStore({ adapter: telemetryPersistence });
// Follow real runs from startup, so they are recorded (and their sounds play) on any tab.
connectLiveRuns();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
