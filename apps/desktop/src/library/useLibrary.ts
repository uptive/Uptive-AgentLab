import { useCallback, useEffect, useState } from "react";
import type { SkillDefinition } from "@agentlab/contracts";
import type { LibraryMcpServer, McpTestResult } from "../../electron/api.js";

// Shared access to the skill and MCP server libraries (main process) for the Tools & skills view
// and the agent editor.

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}

export function useLibrary() {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [servers, setServers] = useState<LibraryMcpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    if (!window.agentlab?.skills) {
      setLoading(false);
      setError("Tools and skills are only available in the AgentLab desktop app.");
      return;
    }
    setLoading(true);
    try {
      const [s, m] = await Promise.all([window.agentlab.skills.list(), window.agentlab.mcpServers.list()]);
      setSkills(s);
      setServers(m);
      setError(undefined);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { skills, servers, loading, error, refresh };
}

// Connection tests take a few seconds, so results are shared between views for the session.
const testCache = new Map<string, Promise<McpTestResult>>();

export function testServer(id: string, force = false): Promise<McpTestResult> {
  let pending = force ? undefined : testCache.get(id);
  if (!pending) {
    pending = window.agentlab.mcpServers.test(id).catch((e) => ({ status: "failed" as const, tools: [], error: errorMessage(e) }));
    testCache.set(id, pending);
  }
  return pending;
}

export function forgetServerTest(id: string) {
  testCache.delete(id);
}

export function useServerTest(id: string | undefined, enabled: boolean) {
  const [result, setResult] = useState<McpTestResult>();
  const [testing, setTesting] = useState(false);

  const run = useCallback(
    async (force = false) => {
      if (!id) return;
      setTesting(true);
      try {
        setResult(await testServer(id, force));
      } finally {
        setTesting(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (enabled) void run();
  }, [enabled, run]);

  return { result, testing, retest: () => run(true) };
}
