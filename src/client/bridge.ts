// Minimal MCP Apps (2026-01-26) app-side bridge. Replaces the ~129 KB gz official client for this job.
import type { Transport } from "./runtime.js";
declare const __VERSION__: string; // package.json version, set by build.mjs

export type Port = { post(msg: unknown): void; listen(fn: (msg: any) => void): void };
const windowPort = (): Port => ({
  post: (m) => window.parent.postMessage(m, "*"),
  listen: (fn) => window.addEventListener("message", (e) => e.source === window.parent && fn(e.data)),
});

function applyHost(ctx: any) {
  if (!ctx) return;
  const r = document.documentElement;
  if (ctx.theme) r.dataset.theme = ctx.theme;
  const v = ctx.styles?.variables;
  if (v) for (const k in v) v[k] != null && r.style.setProperty(k, v[k]);
  const f = ctx.styles?.css?.fonts;
  if (f && !document.getElementById("p-fonts")) {
    const s = document.createElement("style");
    s.id = "p-fonts"; s.textContent = f;
    document.head.append(s);
  }
}

export async function mcpBridge(port: Port = windowPort()): Promise<Transport> {
  let id = 0;
  const pending = new Map<number, [(v: any) => void, (e: any) => void]>();
  const post = (m: object) => port.post({ jsonrpc: "2.0", ...m });
  port.listen((m) => {
    if (m?.id != null && !m.method) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p?.[1](new Error(m.error.message)) : p?.[0](m.result);
    } else if (m?.method === "ui/notifications/host-context-changed") applyHost(m.params);
    else if (m?.id != null) post({ id: m.id, result: {} }); // ping, ui/resource-teardown, anything else: ack
  });
  const notify = (method: string, params: unknown = {}) => post({ method, params });
  const request = (method: string, params: unknown, signal?: AbortSignal) =>
    new Promise<any>((res, rej) => {
      const n = ++id;
      pending.set(n, [res, rej]); post({ id: n, method, params });
      // Standard MCP cancellation: the host forwards it and the server stops holding the call.
      signal?.addEventListener("abort", () => { if (pending.delete(n)) { notify("notifications/cancelled", { requestId: n }); rej(); } }, { once: true });
    });

  const init = await request("ui/initialize", { appInfo: { name: "mcp-projector", version: __VERSION__ }, appCapabilities: {}, protocolVersion: "2026-01-26" });
  applyHost(init?.hostContext);
  notify("ui/notifications/initialized");
  await new Promise((r) => setTimeout(r, 0));

  let last = 0;
  new ResizeObserver(() => {
    const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (h !== last) notify("ui/notifications/size-changed", { width: innerWidth, height: (last = h) });
  }).observe(document.body);

  return {
    call: async (name, args, signal) => {
      const r = await request("tools/call", { name, arguments: args }, signal);
      if (r?.isError) throw new Error(r.content?.[0]?.text ?? "tool error");
      return r;
    },
  };
}
