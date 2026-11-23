// Web transport: POST for tool calls, fetch-streamed SSE for live updates (auto-reconnects with the seq cursor).
import type { Transport, Patch } from "./runtime.js";

export const httpTransport = (base: string): Transport => ({
  async call(tool, args) {
    const name = tool === "p_call" ? String(args.tool) : tool;
    const r = await fetch(`${base}/tool/${encodeURIComponent(name)}`, {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", "P-Req": "1" },
      body: JSON.stringify(args),
    });
    if (r.status === 401) location.reload();
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? r.statusText);
    return { structuredContent: j };
  },
  stream(pid, since, on) {
    const go = async (wait: number): Promise<void> => {
      try {
        const r = await fetch(`${base}/stream?pid=${pid}&since=${since()}`, { credentials: "same-origin", headers: { "P-Req": "1" } });
        if (r.status === 401 || r.status === 410) return location.reload();
        const rd = r.body!.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          buf += value;
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 2);
            if (line.startsWith("data: ")) on(JSON.parse(line.slice(6)) as Patch[]);
          }
        }
        wait = 500;
      } catch {}
      setTimeout(() => go(Math.min(wait * 2, 10_000)), wait);
    };
    go(500);
  },
});
