import type { SourcedAgent } from "../electron/api.js";

// Shared by the Agents view and the flow editor so both warn with the same words.

export const PROMOTION_SUMMARY =
  "Promoting copies this agent to MongoDB, where the whole team can see, use and edit it, and deletes its " +
  "local JSON file from data/local-agents/. It keeps its id, so flows that use it keep working.";

/** Text for the confirm dialog shown right before promoting. */
export function promotionConfirmText(agent: SourcedAgent): string {
  return (
    `Promote "${agent.name}" to the database?\n\n` +
    "• The whole team will be able to see, use and edit it.\n" +
    "• Its local file in data/local-agents/ will be deleted. Keep a copy first if you want one.\n" +
    "• It keeps its id, so flows that use it keep working."
  );
}
