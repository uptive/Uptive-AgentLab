/**
 * Save/open flow JSON. Uses the Electron bridge when available and falls back
 * to browser download/upload when the renderer runs outside Electron.
 */

export type SaveOutcome = { canceled: true } | { canceled: false; filePath?: string };
export type OpenOutcome = { canceled: true } | { canceled: false; filePath?: string; content: string };

export async function saveFlowJson(json: string, suggestedName: string, filePath?: string): Promise<SaveOutcome> {
  if (window.agentlab) return window.agentlab.flows.save(json, { suggestedName, filePath });

  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${suggestedName}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return { canceled: false };
}

export async function openFlowJson(): Promise<OpenOutcome> {
  if (window.agentlab) return window.agentlab.flows.open();

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { canceled: false, content: await file.text() } : { canceled: true });
    };
    input.oncancel = () => resolve({ canceled: true });
    input.click();
  });
}
