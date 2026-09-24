import type { Recommendation } from "@agentlab/contracts";

const demoRecommendations: Recommendation[] = [];

export function OptimizeView() {
  return (
    <div>
      <h1>Optimize</h1>
      <p>Analyze a run or flow and get improvement suggestions.</p>
      {demoRecommendations.length === 0 ? <p>No recommendations yet.</p> : null}
    </div>
  );
}
