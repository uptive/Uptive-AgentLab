import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { AgentDefinition } from "@agentlab/contracts";
import type { AgentJudgement, AgentTestResult, SchemaCheck } from "../../electron/api.js";
import { sampleFromSchema } from "../sampleFromSchema.js";
import { alpha, theme } from "../theme.js";

// Runs the agent as currently filled in (saved or not) on a sample input, checks input and
// output against the schemas, and optionally asks Claude to grade the output. Nothing is saved.

const button: CSSProperties = {
  padding: "7px 16px",
  borderRadius: 999,
  border: "none",
  background: theme.primary,
  color: theme.onPrimary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 13,
  cursor: "pointer",
};

const ghost: CSSProperties = { ...button, background: "transparent", color: theme.textSecondary, border: `1px solid ${theme.border}` };

const code: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "9px 12px",
  borderRadius: 8,
  border: `1px solid ${theme.border}`,
  background: theme.codeBg,
  color: theme.text,
  fontFamily: theme.fontMono,
  fontSize: 12,
  lineHeight: 1.5,
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const label: CSSProperties = { fontSize: 12, color: theme.textMuted, marginBottom: 4 };

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** JSON when it parses, otherwise the raw text, so plain-text agents can be tested too. */
function parseInput(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
const formatUsd = (usd: number) => `$${usd.toFixed(4)}`;

const CHECK_LABELS: Record<SchemaCheck["status"], string> = {
  valid: "Matches schema",
  invalid: "Does not match schema",
  "no-schema": "No schema to check",
  "bad-schema": "Schema does not compile",
  skipped: "Not checked (run did not complete)",
};

function CheckRow({ title, check }: { title: string; check: SchemaCheck }) {
  const color =
    check.status === "valid" ? theme.statusActive : check.status === "invalid" || check.status === "bad-schema" ? theme.danger : theme.textMuted;
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 13 }}>
        <span style={{ color: theme.textSecondary, width: 52 }}>{title}</span>
        <span style={{ color, fontWeight: 600 }}>
          {check.status === "valid" ? "✓ " : check.status === "invalid" || check.status === "bad-schema" ? "✗ " : ""}
          {CHECK_LABELS[check.status]}
        </span>
      </div>
      {check.errors.length > 0 ? (
        <ul style={{ margin: "4px 0 0 60px", padding: 0, fontFamily: theme.fontMono, fontSize: 12, color: theme.errorText }}>
          {check.errors.slice(0, 8).map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Metric({ name, value, over }: { name: string; value: string; over?: string }) {
  return (
    <div title={over} style={{ padding: "8px 10px", borderRadius: 8, background: over ? alpha(theme.danger, 12) : theme.codeBg, border: `1px solid ${over ? theme.danger : theme.border}` }}>
      <div style={label}>{name}</div>
      <div style={{ fontSize: 15, fontWeight: 600, color: over ? theme.danger : theme.text }}>{value}</div>
    </div>
  );
}

function Judgement({ judgement }: { judgement: AgentJudgement }) {
  const color = judgement.score >= 4 ? theme.statusActive : judgement.score === 3 ? theme.warning : theme.danger;
  const list = (title: string, items: string[]): ReactNode =>
    items.length > 0 ? (
      <div style={{ marginTop: 8 }}>
        <div style={label}>{title}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }}>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div style={{ marginTop: 12, padding: 12, borderRadius: 8, border: `1px solid ${theme.border}` }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
        <span style={{ fontSize: 22, fontWeight: 700, color }}>{judgement.score}/5</span>
        <span style={{ fontSize: 13 }}>{judgement.verdict}</span>
      </div>
      {list("Issues", judgement.issues)}
      {list("Done well", judgement.strengths)}
    </div>
  );
}

interface HistoryEntry {
  id: string;
  model: string;
  result: AgentTestResult;
  score?: number;
}

export function AgentTestPanel({ buildAgent, resetKey }: { buildAgent: () => AgentDefinition; resetKey: string }) {
  const [inputText, setInputText] = useState("");
  const [testId, setTestId] = useState<string>();
  const [live, setLive] = useState("");
  const [liveTokens, setLiveTokens] = useState<{ inputTokens: number; outputTokens: number }>();
  const [tested, setTested] = useState<{ id: string; agent: AgentDefinition; input: unknown; result: AgentTestResult }>();
  const [judgement, setJudgement] = useState<AgentJudgement>();
  const [judging, setJudging] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string>();
  const currentTest = useRef<string>();

  // A different agent in the drawer starts from a clean panel.
  useEffect(() => {
    setInputText("");
    setTested(undefined);
    setJudgement(undefined);
    setHistory([]);
    setError(undefined);
    setLive("");
  }, [resetKey]);

  useEffect(
    () =>
      window.agentlab.agents.onTestStream((chunks) => {
        for (const chunk of chunks) {
          if (chunk.stepRunId !== currentTest.current) continue;
          if (chunk.type === "delta") setLive((text) => text + chunk.text);
          else if (chunk.type === "usage") setLiveTokens({ inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens });
          else if (chunk.type === "block") {
            const marker = chunk.block === "tool_use" ? `\n→ ${chunk.toolName ?? "tool"} ` : chunk.block === "text" ? "\n" : "\n· thinking · ";
            setLive((text) => (text ? text + marker : marker.trimStart()));
          }
        }
      }),
    [],
  );

  // Stop a running test when the drawer closes.
  useEffect(() => () => void (currentTest.current && window.agentlab.agents.cancelTest(currentTest.current)), []);

  function fillFromSchema() {
    setError(undefined);
    try {
      const schema = buildAgent().inputSchema;
      if (schema === undefined) throw new Error("Add an input schema first, or type an input.");
      setInputText(JSON.stringify(sampleFromSchema(schema), null, 2));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function run() {
    setError(undefined);
    let agent: AgentDefinition;
    try {
      agent = buildAgent();
    } catch (e) {
      setError(errorMessage(e));
      return;
    }
    if (!inputText.trim()) {
      setError("Enter a test input first.");
      return;
    }
    const input = parseInput(inputText);
    const id = `test-${crypto.randomUUID()}`;
    currentTest.current = id;
    setTestId(id);
    setLive("");
    setLiveTokens(undefined);
    setJudgement(undefined);
    try {
      const result = await window.agentlab.agents.test({ testId: id, agent, input });
      if (currentTest.current !== id) return;
      setTested({ id, agent, input, result });
      setHistory((prev) => [{ id, model: agent.model, result }, ...prev].slice(0, 10));
    } catch (e) {
      if (currentTest.current === id) setError(errorMessage(e));
    } finally {
      if (currentTest.current === id) {
        currentTest.current = undefined;
        setTestId(undefined);
      }
    }
  }

  async function judge() {
    if (!tested) return;
    setJudging(true);
    setError(undefined);
    try {
      const result = await window.agentlab.agents.judge({ agent: tested.agent, input: tested.input, output: tested.result.output });
      setJudgement(result);
      setHistory((prev) => prev.map((entry) => (entry.id === tested.id ? { ...entry, score: result.score } : entry)));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setJudging(false);
    }
  }

  const running = testId !== undefined;
  const result = tested?.result;
  const limits = tested?.agent.limits;
  const totalTokens = result ? result.usage.inputTokens + result.usage.outputTokens : 0;

  return (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 13, color: theme.textSecondary }}>
        Runs the agent as filled in above, saved or not, with its tools and skills. Test runs are not saved to Runs.
      </p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={label}>Test input (JSON, or plain text)</div>
        <button type="button" onClick={fillFromSchema} style={{ ...ghost, padding: "2px 10px", fontSize: 12 }} disabled={running}>
          Fill from input schema
        </button>
      </div>
      <textarea
        aria-label="Test input"
        style={{ ...code, minHeight: 100, resize: "vertical", marginTop: 4 }}
        value={inputText}
        onChange={(e) => setInputText(e.target.value)}
        spellCheck={false}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "10px 0" }}>
        {running ? (
          <button type="button" style={ghost} onClick={() => testId && void window.agentlab.agents.cancelTest(testId)}>
            Stop
          </button>
        ) : (
          <button type="button" style={button} onClick={() => void run()}>
            Run test
          </button>
        )}
        {running ? (
          <span style={{ fontSize: 13, color: theme.textMuted }}>
            Running…{liveTokens ? ` ${liveTokens.inputTokens + liveTokens.outputTokens} tokens` : ""}
          </span>
        ) : null}
      </div>

      {error ? <div style={{ ...code, background: theme.errorBg, color: theme.errorText, fontFamily: theme.fontBody, marginBottom: 10 }}>{error}</div> : null}

      {running && live ? <pre style={{ ...code, maxHeight: 220, overflow: "auto", color: theme.textSecondary }}>{live}</pre> : null}

      {result && !running ? (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 12 }}>
            <Metric name="Time" value={formatMs(result.usage.latencyMs)} />
            <Metric
              name="Tokens in / out"
              value={`${result.usage.inputTokens} / ${result.usage.outputTokens}`}
              over={limits?.maxTokens !== undefined && totalTokens > limits.maxTokens ? `Over the ${limits.maxTokens} token limit` : undefined}
            />
            <Metric
              name="Cost"
              value={formatUsd(result.usage.estimatedCostUsd)}
              over={limits?.maxCostUsd !== undefined && result.usage.estimatedCostUsd > limits.maxCostUsd ? `Over the $${limits.maxCostUsd} limit` : undefined}
            />
            <Metric name="Tool calls" value={String(result.toolCallCount)} />
          </div>

          {result.status !== "completed" ? (
            <div style={{ fontSize: 13, color: result.status === "cancelled" ? theme.textMuted : theme.danger, marginBottom: 8 }}>
              {result.status === "cancelled" ? "Stopped." : `Failed: ${result.error ?? "unknown error"}`}
            </div>
          ) : null}

          <CheckRow title="Input" check={result.inputCheck} />
          <CheckRow title="Output" check={result.outputCheck} />

          {result.status === "completed" ? (
            <>
              <div style={{ ...label, marginTop: 10 }}>Output</div>
              <pre style={{ ...code, maxHeight: 320, overflow: "auto" }}>
                {typeof result.output === "string" ? result.output : JSON.stringify(result.output, null, 2)}
              </pre>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
                <button type="button" style={ghost} onClick={() => void judge()} disabled={judging}>
                  {judging ? "Judging…" : judgement ? "Judge again" : "Judge quality"}
                </button>
                <span style={{ fontSize: 12, color: theme.textMuted }}>Claude scores the output against the instructions (one extra model call).</span>
              </div>
              {judgement ? <Judgement judgement={judgement} /> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {history.length > 1 ? (
        <div style={{ marginTop: 16 }}>
          <div style={label}>Earlier test runs (this session)</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: theme.textMuted, textAlign: "left" }}>
                {["Model", "Status", "Time", "Tokens", "Cost", "Output", "Score"].map((h) => (
                  <th key={h} style={{ fontWeight: 500, padding: "4px 6px", borderBottom: `1px solid ${theme.border}` }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {history.map(({ id, model, result: r, score }) => (
                <tr key={id}>
                  <td style={{ padding: "4px 6px", fontFamily: theme.fontMono }}>{model}</td>
                  <td style={{ padding: "4px 6px" }}>{r.status}</td>
                  <td style={{ padding: "4px 6px" }}>{formatMs(r.usage.latencyMs)}</td>
                  <td style={{ padding: "4px 6px" }}>{r.usage.inputTokens + r.usage.outputTokens}</td>
                  <td style={{ padding: "4px 6px" }}>{formatUsd(r.usage.estimatedCostUsd)}</td>
                  <td style={{ padding: "4px 6px" }}>{r.outputCheck.status === "valid" ? "✓" : r.outputCheck.status === "invalid" ? "✗" : "–"}</td>
                  <td style={{ padding: "4px 6px" }}>{score ? `${score}/5` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
