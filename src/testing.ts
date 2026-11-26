// Test harness for agents writing UIs: drive the agent side and the UI side of a real server, no browser needed.
//   const t = await testUi(createServer);
//   const view = await t.mount();
//   await t.agent.callTool({ name: "add_note", arguments: { title: "x", body: "" } });
//   await view.until((text) => text.includes("x"));
// The client comes from whichever MCP SDK is installed: v1 (its client can drive a v2 server too), else v2.
const v1 = await import("@modelcontextprotocol/sdk/client/index.js").catch(() => undefined);
const { Client, InMemoryTransport }: any = v1
  ? { ...v1, ...await import("@modelcontextprotocol/sdk/inMemory.js") }
  // @ts-ignore: an optional peer, not installed here
  : await import("@modelcontextprotocol/client");

/** The MCP client: `Client` from the installed SDK. */
type TestClient = {
  callTool(params: { name: string; arguments?: Record<string, unknown> }, ...options: any[]): Promise<any>;
  listTools(...options: any[]): Promise<{ tools: any[] }>;
  close(): Promise<void>;
  [member: string]: any;
};
type Factory = () => { connect(t: any): Promise<void> } | Promise<{ connect(t: any): Promise<void> }>;

async function connect(factory: Factory, name: string): Promise<TestClient> {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await (await factory()).connect(b);
  const c = new Client({ name, version: "1" });
  await c.connect(a);
  return c;
}
const textOf = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

export async function testUi(factory: Factory) {
  const agent = await connect(factory, "agent");
  const host = await connect(factory, "host");
  const tools = (await host.listTools()).tools;
  const resourceUri = tools.map((t: any) => t._meta?.ui?.resourceUri).find(Boolean) as string | undefined;

  /** What the model sees: tools not marked app-only. */
  const modelTools = tools.filter((t: any) => !(t._meta?.ui?.visibility ?? ["model"]).every((v: string) => v === "app"));

  /** Open the UI like a host would, with optional view params. */
  async function mount(params: Record<string, unknown> = {}) {
    let doc = "", h: string | undefined;
    /** One check, as the runtime makes on its cadence and straight after an action. */
    const refresh = async () => {
      const s: any = await host.callTool({ name: "p_sync", arguments: { params, h } });
      if (s.isError) throw new Error(s.content?.[0]?.text);
      const r = s.structuredContent;
      if (r.html) { h = r.h; doc = r.html; }
    };
    await refresh();
    return {
      html: () => doc,
      text: () => textOf(doc),
      /** Call a tool the way a click on hx-tool would. Throws if the tool reports an error. */
      async click(tool: string, args: Record<string, unknown> = {}) {
        const res: any = await host.callTool({ name: tool, arguments: args });
        if (res.isError) throw new Error(res.content?.[0]?.text);
        await refresh();
        return res;
      },
      /** Change view params the way a `set` control would. */
      async set(p: Record<string, unknown>) { params = { ...params, ...p }; await refresh(); },
      /** Check for changes until the visible text matches (a real page checks every few seconds; this checks at once and often). */
      async until(pred: (text: string, html: string) => boolean, ms = 2000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { await refresh(); if (pred(textOf(doc), doc)) return; await new Promise((r) => setTimeout(r, 10)); }
        throw new Error(`until() timed out. Current UI text: ${textOf(doc).slice(0, 300)}`);
      },
      /** Stop the view. Nothing is held open, so this only exists for symmetry with a real page. */
      close() {},
    };
  }

  return { agent, host, tools, modelTools, resourceUri, mount, close: async () => { await agent.close(); await host.close(); } };
}
