// Fragment engine: dependency tracking, coalesced writes, per-user instances, patch queues.
import { esc, raw, type Html } from "./html.js";

export type Params = Record<string, string>;
export type Patch = { id: string; html: string; seq: number };
export type LoadCtx = { user: string; id?: string };
export type Loaders = Record<string, (ctx: LoadCtx) => unknown>;
export type Data<L extends Loaders, K extends keyof L> = Awaited<ReturnType<L[K]>>;

export type FragmentCtx<L extends Loaders> = {
  /** Who is viewing. In MCP hosts: from authInfo; on the web: from the link session. */
  user: string;
  params: Params;
  /** Read data and subscribe this fragment to it. `read("note", "42")` subscribes to "note:42". */
  read<K extends keyof L & string>(key: K, id?: string | number): Promise<Data<L, K>>;
  /** Render a child fragment; it updates independently. */
  frag(name: string, params?: Params): Promise<Html>;
};
export type FragmentFn<L extends Loaders> = (ctx: FragmentCtx<L>) => Html | Promise<Html>;

type Inst = { key: string; dom: string; name: string; params: Params; user: string; deps: Set<string>; clients: Set<string>; last: string };
type Client = { id: string; user: string; queue: Patch[]; wake?: () => void; listeners: Set<(p: Patch[]) => void>; seen: number };

const domId = (name: string, params: Params) => {
  const q = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  return q ? `${name}?${q}` : name;
};
const base = (k: string) => { const i = k.indexOf(":"); return i < 0 ? k : k.slice(0, i); };

export type EngineOptions<L extends Loaders> = {
  load: L;
  /** Drop clients that haven't synced for this long (ms). */
  idleMs?: number;
  /** Called for each rendered fragment in dev; used for lints. */
  onRender?: (name: string, html: string) => void;
};

export function createEngine<L extends Loaders>(o: EngineOptions<L>) {
  const frags = new Map<string, FragmentFn<L>>();
  const insts = new Map<string, Inst>();
  const byKey = new Map<string, Set<string>>();   // "note:42" -> inst keys
  const byBase = new Map<string, Set<string>>();  // "note"    -> inst keys (any id)
  const clients = new Map<string, Client>();
  const idleMs = o.idleMs ?? 120_000;
  let seq = 0;

  const index = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  const unindex = (inst: Inst) => inst.deps.forEach((d) => { byKey.get(d)?.delete(inst.key); byBase.get(base(d))?.delete(inst.key); });

  async function load(user: string, key: string, id: string | undefined, memo: Map<string, Promise<unknown>>) {
    const fn = o.load[key];
    if (!fn) throw new Error(`No loader for "${key}". Add it to defineUi({ load: { ${key}: (ctx) => ... } }). Known: ${Object.keys(o.load).join(", ") || "(none)"}`);
    const mk = `${user}\0${key}\0${id ?? ""}`;
    let p = memo.get(mk);
    if (!p) memo.set(mk, (p = Promise.resolve(fn({ user, id }))));
    return p;
  }

  async function render(inst: Inst, memo: Map<string, Promise<unknown>>): Promise<string> {
    unindex(inst);
    inst.deps.clear();
    const fn = frags.get(inst.name);
    if (!fn) throw new Error(`Unknown fragment "${inst.name}". Defined: ${[...frags.keys()].join(", ") || "(none)"}. Add ui.fragment("${inst.name}", ...).`);
    const ctx: FragmentCtx<L> = {
      user: inst.user,
      params: inst.params,
      read: (key, id) => {
        const dep = id == null ? key : `${key}:${id}`;
        if (!inst.deps.has(dep)) { inst.deps.add(dep); index(byKey, dep, inst.key); index(byBase, key, inst.key); }
        return load(inst.user, key, id == null ? undefined : String(id), memo) as any;
      },
      frag: async (name, params = {}) => raw(await mount(inst.clients, inst.user, name, params, memo)),
    };
    const body = (await fn(ctx)).__html;
    o.onRender?.(inst.name, body);
    return (inst.last = `<p-f id="${esc(inst.dom)}">${body}</p-f>`);
  }

  async function mount(cids: Set<string>, user: string, name: string, params: Params = {}, memo = new Map()) {
    const dom = domId(name, params);
    const key = `${user}\0${dom}`;
    let inst = insts.get(key);
    if (!inst) insts.set(key, (inst = { key, dom, name, params, user, deps: new Set(), clients: new Set(), last: "" }));
    cids.forEach((c) => inst!.clients.add(c));
    return render(inst, memo);
  }

  function push(cid: string, patches: Patch[]) {
    const c = clients.get(cid);
    if (!c || !patches.length) return;
    c.queue.push(...patches);
    c.listeners.forEach((l) => l(patches));
    c.wake?.();
  }

  function drain(cid: string, since: number) {
    const c = clients.get(cid);
    if (!c) return [];
    c.seen = Date.now();
    c.queue = c.queue.filter((p) => p.seq > since);
    return c.queue.slice();
  }

  // ---- coalesced writes: many write() calls in one tick → one render pass ----
  let dirty = new Set<string>();
  let pending: Promise<void> | null = null;
  async function flush() {
    const keys = dirty; dirty = new Set(); pending = null;
    const targets = new Set<string>();
    for (const k of keys) (k.includes(":") ? byKey.get(k) : byBase.get(k))?.forEach((i) => targets.add(i));
    const memo = new Map<string, Promise<unknown>>();
    const out = new Map<string, Patch[]>();
    await Promise.all([...targets].map(async (ik) => {
      const inst = insts.get(ik);
      if (!inst || !inst.clients.size) return;
      const prev = inst.last;
      const next = await render(inst, memo);
      if (next === prev) return; // nothing visible changed: send nothing
      const patch = { id: inst.dom, html: next, seq: ++seq };
      inst.clients.forEach((c) => (out.get(c) ?? out.set(c, []).get(c)!).push(patch));
    }));
    out.forEach((ps, c) => push(c, ps.sort((a, b) => a.seq - b.seq)));
  }

  function drop(cid: string) {
    clients.get(cid)?.wake?.();
    clients.delete(cid);
    for (const [k, inst] of insts) {
      inst.clients.delete(cid);
      if (!inst.clients.size) { unindex(inst); insts.delete(k); }
    }
  }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const c of clients.values()) if (!c.listeners.size && now - c.seen > idleMs) drop(c.id);
  }, Math.min(idleMs, 30_000));
  (sweep as any).unref?.();

  const client = (pid: string, user?: string) => {
    const c = clients.get(pid);
    if (!c) throw Object.assign(new Error("Unknown UI client: re-mount."), { code: "P_REMOUNT" });
    if (user != null && c.user !== user) throw new Error("UI client belongs to another user.");
    return c;
  };

  return {
    fragment(name: string, fn: FragmentFn<L>) { frags.set(name, fn); },
    fragments: () => [...frags.keys()],

    /** Mark data as changed. `write("notes")` refreshes every reader of notes and notes:*; `write("note:42")` only that id. */
    write(...keys: string[]): Promise<void> {
      keys.forEach((k) => dirty.add(k));
      return (pending ??= Promise.resolve().then(flush));
    },

    async mount(user: string, root: string, params: Params = {}) {
      const c: Client = { id: crypto.randomUUID(), user, queue: [], listeners: new Set(), seen: Date.now() };
      clients.set(c.id, c);
      return { pid: c.id, since: seq, html: await mount(new Set([c.id]), user, root, params) };
    },

    /** Render without a client (tests, previews). */
    async renderOnce(user: string, root: string, params: Params = {}) {
      const tmp = crypto.randomUUID();
      try { return await mount(new Set([tmp]), user, root, params); } finally { drop(tmp); }
    },

    async sync(pid: string, since: number, user?: string, waitMs = 25_000): Promise<Patch[]> {
      const c = client(pid, user);
      const ready = drain(pid, since);
      if (ready.length) return ready;
      await new Promise<void>((res) => { const t = setTimeout(res, waitMs); c.wake = () => { clearTimeout(t); c.wake = undefined; res(); }; });
      return drain(pid, since);
    },

    subscribe(pid: string, since: number, user: string | undefined, fn: (p: Patch[]) => void) {
      const c = client(pid, user);
      const backlog = drain(pid, since);
      if (backlog.length) fn(backlog);
      const l = (p: Patch[]) => { c.seen = Date.now(); fn(p); };
      c.listeners.add(l);
      return () => { c.listeners.delete(l); c.seen = Date.now(); };
    },

    /** Run a handler for a UI client and return its pending patches alongside the untouched result. */
    async call<R>(pid: string, since: number, user: string | undefined, fn: () => Promise<R>) {
      client(pid, user);
      const result = await fn();
      await pending; // let any write() triggered by the handler finish rendering
      return { result, patches: drain(pid, since) };
    },

    userOf: (pid: string) => clients.get(pid)?.user,
    drop,
    stats: () => ({ clients: clients.size, fragments: insts.size, keys: byKey.size }),
    close: () => clearInterval(sweep),
  };
}

export type Engine<L extends Loaders = Loaders> = ReturnType<typeof createEngine<L>>;
