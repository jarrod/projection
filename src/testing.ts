// Test harness for agents writing UIs: drive the agent side and the UI side of a real server, no browser needed.
//   const t = await testUi(createServer);
//   const view = await t.mount();
//   await t.agent.callTool({ name: "add_note", arguments: { title: "x", body: "" } });
//   await view.until((text) => text.includes("x"));
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

type Factory = () => { connect(t: any): Promise<void> } | Promise<{ connect(t: any): Promise<void> }>;

async function connect(factory: Factory, name: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await (await factory()).connect(b);
  const c = new Client({ name, version: "1" });
  await c.connect(a);
  return c;
}

/** Replace <p-f id="..."> ... </p-f> (balanced) inside doc with next. */
function splice(doc: string, id: string, next: string) {
  const open = `<p-f id="${id.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`;
  const start = doc.indexOf(open);
  if (start < 0) return doc;
  let depth = 0, i = start;
  const re = /<p-f\b|<\/p-f>/g;
  re.lastIndex = start;
  for (let m; (m = re.exec(doc)); ) {
    depth += m[0] === "</p-f>" ? -1 : 1;
    if (!depth) { i = m.index + 6; break; }
  }
  return doc.slice(0, start) + next + doc.slice(i);
}
const textOf = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export async function testUi(factory: Factory) {
  const agent = await connect(factory, "agent");
  const host = await connect(factory, "host");
  const tools = (await host.listTools()).tools;
  const resourceUri = tools.map((t: any) => t._meta?.ui?.resourceUri).find(Boolean) as string | undefined;

  /** What the model sees: tools not marked app-only. */
  const modelTools = tools.filter((t: any) => !(t._meta?.ui?.visibility ?? ["model"]).every((v: string) => v === "app"));

  async function mount(root?: string) {
    const r: any = (await host.callTool({ name: "p_mount", arguments: root ? { root } : {} })).structuredContent;
    let doc: string = r.html, since: number = r.since, closed = false;
    const pid: string = r.pid;
    const apply = (ps: any[] = []) => { for (const p of ps) if (p.seq > since) { since = p.seq; doc = splice(doc, p.id, p.html); } };
    (async () => {
      while (!closed) {
        const s: any = await host.callTool({ name: "p_sync", arguments: { _pid: pid, _since: since } }).catch(() => null);
        if (s?.isError) break;
        apply(s?.structuredContent?.patches);
      }
    })();
    return {
      pid,
      html: () => doc,
      text: () => textOf(doc),
      /** Call a tool the way a click on hx-tool would. */
      async click(tool: string, args: Record<string, unknown> = {}) {
        const res: any = await host.callTool({ name: "p_call", arguments: { tool, args, _pid: pid, _since: since } });
        if (res.isError) throw new Error(res.content?.[0]?.text);
        apply(res.structuredContent.patches);
        return res.structuredContent.result;
      },
      /** Wait until the visible text matches. */
      async until(pred: (text: string, html: string) => boolean, ms = 2000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (pred(textOf(doc), doc)) return; await new Promise((r) => setTimeout(r, 10)); }
        throw new Error(`until() timed out. Current UI text: ${textOf(doc).slice(0, 300)}`);
      },
      close() { closed = true; },
    };
  }

  return { agent, host, tools, modelTools, resourceUri, mount, close: async () => { await agent.close(); await host.close(); } };
}
