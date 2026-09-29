export interface Usage {
  /** Every input token the model read, including the part served from the prompt cache. */
  inputTokens: number;
  /** Part of `inputTokens` read from the prompt cache, billed at a fraction of the input price. Absent on older runs. */
  cacheReadTokens?: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
}
