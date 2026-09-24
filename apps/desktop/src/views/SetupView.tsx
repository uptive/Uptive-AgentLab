import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { LocalTool, ToolOutputStream, ToolRun, ToolRunResult } from "../../electron/api.js";
import { theme } from "../theme.js";

const titleStyle: CSSProperties = { fontFamily: theme.fontTitle, fontWeight: 600, color: theme.title, margin: 0 };

const pillButton: CSSProperties = {
  padding: "8px 18px",
  borderRadius: 999,
  border: "none",
  background: theme.primary,
  color: theme.onPrimary,
  fontFamily: theme.fontBody,
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
};

const ghostButton: CSSProperties = {
  ...pillButton,
  background: "transparent",
  color: theme.textSecondary,
  border: `1px solid ${theme.border}`,
};

const codeStyle: CSSProperties = {
  fontFamily: theme.fontMono,
  fontSize: 12,
  background: theme.codeBg,
  borderRadius: 6,
  padding: "6px 10px",
  overflowX: "auto",
  whiteSpace: "pre",
};

/** Splits a command line into args, honoring "double" and 'single' quotes. */
export function splitArgs(line: string): string[] {
  const args: string[] = [];
  let current = "";
  let quote: string | undefined;
  let hasToken = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = undefined;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasToken = true;
    } else if (/\s/.test(ch)) {
      if (hasToken) args.push(current);
      current = "";
      hasToken = false;
    } else {
      current += ch;
      hasToken = true;
    }
  }
  if (hasToken) args.push(current);
  return args;
}

export function SetupView() {
  const [tools, setTools] = useState<LocalTool[]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const load = async (refresh: boolean) => {
    setLoading(true);
    setError(undefined);
    try {
      setTools(await (refresh ? window.agentlab.tools.refresh() : window.agentlab.tools.list()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(false);
  }, []);

  const replace = (tool: LocalTool) => setTools((current) => current?.map((t) => (t.id === tool.id ? tool : t)));

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 8 }}>
        <h1 style={titleStyle}>Setup</h1>
        <button style={ghostButton} onClick={() => void load(true)} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </div>
      <p style={{ color: theme.textSecondary, marginTop: 0, marginBottom: 20 }}>
        Programs on this computer that AgentLab needs to run agents.
      </p>

      {error ? (
        <p role="alert" style={{ padding: "10px 14px", borderRadius: 8, background: theme.errorBg, color: theme.errorText }}>
          {error}
        </p>
      ) : null}

      {!tools && !error ? <p style={{ color: theme.textMuted }}>Looking for tools…</p> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {tools?.map((tool) => <ToolCard key={tool.id} tool={tool} onChange={replace} />)}
      </div>
    </div>
  );
}

type Status = { label: string; background: string; color: string };

function statusOf(tool: LocalTool): Status {
  if (!tool.installed) {
    return tool.path
      ? { label: "Not working", background: theme.warning, color: theme.onStatus }
      : { label: "Not installed", background: theme.statusDisabledBg, color: theme.statusDisabledText };
  }
  if (tool.setup && !tool.setup.ready) return { label: "Needs setup", background: theme.warning, color: theme.onStatus };
  return { label: "Ready", background: theme.statusActive, color: theme.onStatus };
}

function ToolCard({ tool, onChange }: { tool: LocalTool; onChange: (tool: LocalTool) => void }) {
  const [tryOpen, setTryOpen] = useState(false);
  const status = statusOf(tool);

  return (
    <section
      style={{
        padding: 16,
        borderRadius: 12,
        border: `1px solid ${theme.border}`,
        background: theme.surface,
        boxShadow: theme.cardShadow,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2 style={{ ...titleStyle, fontSize: 16 }}>{tool.name}</h2>
            <span
              style={{
                padding: "2px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: status.background,
                color: status.color,
              }}
            >
              {status.label}
            </span>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 14, color: theme.textSecondary }}>{tool.description}</p>
          {tool.path ? (
            <p style={{ margin: "8px 0 0", fontFamily: theme.fontMono, fontSize: 12, color: theme.textMuted, wordBreak: "break-all" }}>
              {tool.version ? `${tool.version} · ` : ""}
              {tool.path}
            </p>
          ) : null}
          {tool.setup ? <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.textSecondary }}>{tool.setup.detail}</p> : null}
          {tool.error ? <p style={{ margin: "6px 0 0", fontSize: 13, color: theme.danger }}>{tool.error}</p> : null}
        </div>
        {tool.installed ? (
          <button style={ghostButton} onClick={() => setTryOpen((o) => !o)}>
            {tryOpen ? "Close" : "Try it"}
          </button>
        ) : null}
      </div>

      {!tool.installed ? <InstallSection tool={tool} onChange={onChange} /> : null}
      {tool.installed && tool.setup && !tool.setup.ready ? <SetupSection tool={tool} onChange={onChange} /> : null}
      {tryOpen ? <RunPanel tool={tool} /> : null}
    </section>
  );
}

/** Collects streamed output for display, keeping only the tail so long installs stay responsive. */
function useOutputLog() {
  const [log, setLog] = useState("");
  const append = (_stream: ToolOutputStream, chunk: string) => setLog((current) => (current + chunk).slice(-20_000));
  return { log, append, clear: () => setLog("") };
}

function OutputLog({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [text]);
  if (!text) return null;
  return (
    <pre ref={ref} style={{ ...codeStyle, margin: "10px 0 0", maxHeight: 260, overflow: "auto" }}>
      {text}
    </pre>
  );
}

function InstallSection({ tool, onChange }: { tool: LocalTool; onChange: (tool: LocalTool) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [copied, setCopied] = useState(false);
  const output = useOutputLog();
  const isUrl = tool.installHint.startsWith("https://");

  const install = async () => {
    setBusy(true);
    setMessage(undefined);
    output.clear();
    try {
      const { confirmed, result, tool: updated } = await window.agentlab.tools.install(tool.id, output.append);
      if (!confirmed) return;
      if (updated) onChange(updated);
      if (updated?.installed) setMessage(undefined);
      else setMessage(result?.exitCode === 0 ? "The installer finished, but AgentLab can't find the tool yet. Try restarting AgentLab." : "The installer failed. See the output above.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tool.installHint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable; the command is still visible to select by hand.
    }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}` }}>
      {tool.canInstall ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <button style={pillButton} onClick={() => void install()} disabled={busy}>
            {busy ? "Installing…" : `Install ${tool.name}`}
          </button>
          <span style={{ fontSize: 13, color: theme.textSecondary }}>Runs the official installer. You'll be asked to confirm.</span>
        </div>
      ) : null}
      <div style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 6 }}>
        {tool.canInstall ? "Or install it yourself in a terminal:" : "To install:"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <code style={{ ...codeStyle, flex: 1 }}>{tool.installHint}</code>
        {isUrl ? null : (
          <button style={{ ...ghostButton, padding: "4px 12px", fontSize: 13 }} onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
        <a href={tool.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: theme.primary }}>
          Docs
        </a>
      </div>
      <OutputLog text={output.log} />
      {message ? <p style={{ margin: "8px 0 0", fontSize: 13, color: theme.danger }}>{message}</p> : null}
    </div>
  );
}

function SetupSection({ tool, onChange }: { tool: LocalTool; onChange: (tool: LocalTool) => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const output = useOutputLog();

  const fix = async () => {
    setBusy(true);
    setMessage(undefined);
    output.clear();
    try {
      const { tool: updated } = await window.agentlab.tools.fixSetup(tool.id, output.append);
      if (updated) onChange(updated);
      if (updated?.setup && !updated.setup.ready) setMessage(`Still not done: ${updated.setup.detail}`);
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button style={pillButton} onClick={() => void fix()} disabled={busy}>
          {busy ? "Waiting…" : tool.setup!.fixLabel}
        </button>
        <span style={{ fontSize: 13, color: theme.textSecondary }}>
          Opens your browser. Finish there, then come back here.
        </span>
      </div>
      <OutputLog text={output.log} />
      {message ? <p style={{ margin: "8px 0 0", fontSize: 13, color: theme.danger }}>{message}</p> : null}
    </div>
  );
}

function RunPanel({ tool }: { tool: LocalTool }) {
  const [argsLine, setArgsLine] = useState("--version");
  const [run, setRun] = useState<ToolRun>();
  const [result, setResult] = useState<ToolRunResult>();
  const [error, setError] = useState<string>();
  const output = useOutputLog();

  const start = async () => {
    setError(undefined);
    setResult(undefined);
    output.clear();
    const started = window.agentlab.tools.start({ toolId: tool.id, args: splitArgs(argsLine) }, output.append);
    setRun(started);
    try {
      setResult(await started.done);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRun(undefined);
    }
  };

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.border}` }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!run) void start();
        }}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <span style={{ fontFamily: theme.fontMono, fontSize: 13, color: theme.textSecondary }}>{tool.command}</span>
        <input
          value={argsLine}
          onChange={(e) => setArgsLine(e.target.value)}
          placeholder={tool.id === "claude" ? '-p "Say hello"' : "arguments"}
          aria-label={`Arguments for ${tool.command}`}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: `1px solid ${theme.border}`,
            background: theme.surface,
            color: theme.text,
            fontFamily: theme.fontMono,
            fontSize: 13,
          }}
        />
        {run ? (
          <button type="button" style={ghostButton} onClick={() => void run.cancel()}>
            Cancel
          </button>
        ) : (
          <button type="submit" style={pillButton}>
            Run
          </button>
        )}
      </form>

      <OutputLog text={output.log} />
      {error ? <p style={{ color: theme.danger, fontSize: 13 }}>{error}</p> : null}
      {result ? (
        <div style={{ fontSize: 12, color: theme.textMuted, marginTop: 6 }}>
          Exit {result.exitCode ?? result.signal} · {result.durationMs} ms
          {result.cancelled ? " · cancelled" : ""}
          {result.timedOut ? " · timed out" : ""}
          {result.truncated ? " · output truncated" : ""}
        </div>
      ) : null}
    </div>
  );
}
