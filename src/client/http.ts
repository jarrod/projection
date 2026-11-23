// Web transport: one POST per call. p_sync is the same long-poll the MCP host mode uses.
import type { Transport } from "./runtime.js";

export const httpTransport = (base: string): Transport => ({
  async call(tool, args) {
    const r = await fetch(`${base}/${tool === "p_sync" ? "sync" : "tool/" + encodeURIComponent(tool)}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "P-Req": "1" },
      body: JSON.stringify(args),
    });
    if (r.status === 401) location.reload();
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return { structuredContent: j };
  },
});
