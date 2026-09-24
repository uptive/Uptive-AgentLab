import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./theme.css";
import { initTheme } from "./theme.js";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
