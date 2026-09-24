import type { AgentSource } from "../../electron/api.js";
import { alpha, theme } from "../theme.js";
import { WARNING } from "./EditorContext.js";

export const LOCAL_IN_CLOUD_HINT = "Local agent: only on this computer. Teammates opening this cloud flow will see it as an unknown agent.";

/** Small pill saying where an agent is stored. `warn` highlights a local agent used in a cloud flow. */
export function AgentSourceTag({ source, warn }: { source: AgentSource; warn?: boolean }) {
  const color = warn ? WARNING : theme.textMuted;
  return (
    <span
      title={warn ? LOCAL_IN_CLOUD_HINT : source === "local" ? "Stored on this computer only" : "Shared through MongoDB"}
      style={{
        padding: "0 6px",
        borderRadius: 999,
        border: `1px solid ${warn ? WARNING : theme.border}`,
        background: warn ? alpha(WARNING, 13) : "transparent",
        color,
        fontSize: 10,
        fontWeight: 600,
        lineHeight: "16px",
        textTransform: "uppercase",
        letterSpacing: 0.3,
        flexShrink: 0,
      }}
    >
      {source === "local" ? "Local" : "DB"}
    </span>
  );
}
