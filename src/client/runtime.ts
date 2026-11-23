// Browser runtime. Holds no app state, templates or router: it morphs server HTML and turns events into tool calls.
// Attributes: hx-tool, hx-vals, hx-trigger (click|submit|change|input|load), p-debounce, p-close, p-keep, p-local.
import { morph, changed } from "./morph.js";

export type Patch = { id: string; html: string; seq: number };
export interface Transport {
  call(tool: string, args: Record<string, unknown>): Promise<any>;
  /** Push channel. Without one the runtime long-polls p_sync. */
  stream?(pid: string, since: () => number, on: (p: Patch[]) => void): void;
}
export type State = { pid: string; since: number };

const tpl = (s: string) => { const t = document.createElement("template"); t.innerHTML = s; return t.content.firstElementChild!; };

export async function start(t: Transport, state?: State) {
  let pid = "", since = 0;
  const apply = (ps: Patch[] = []) => {
    for (const p of ps) {
      if (p.seq <= since) continue;
      since = p.seq;
      const el = document.getElementById(p.id);
      if (!el) continue;
      changed.clear();
      morph(el, tpl(p.html));
      // highlight only the rows/cards that actually changed
      const hit = new Set<Element>();
      changed.forEach((c) => { const t = c.closest("tr,li,.stat,[p-flash]"); if (t && !t.closest("thead")) hit.add(t); });
      hit.forEach((t) => { t.setAttribute("p-updated", ""); setTimeout(() => t.removeAttribute("p-updated"), 900); });
    }
  };

  if (state) ({ pid, since } = state);
  else {
    const r = (await t.call("p_mount", { root: document.body.dataset.pRoot ?? "app" })).structuredContent;
    ({ pid, since } = r);
    document.body.insertAdjacentHTML("afterbegin", r.html);
  }
  document.documentElement.setAttribute("p-ready", "");

  if (!__RO__) {
    const argsOf = (el: Element) => {
      const form = el instanceof HTMLFormElement ? el : el.closest("form");
      const a: Record<string, unknown> = form && el.matches("form,[type=submit],button:not([type])") ? Object.fromEntries(new FormData(form)) : {};
      const name = el.getAttribute("name");
      if (name && "value" in el) a[name] = (el as HTMLInputElement).type === "checkbox" ? (el as HTMLInputElement).checked : (el as HTMLInputElement).value;
      const v = el.getAttribute("hx-vals");
      return v ? { ...a, ...JSON.parse(v) } : a;
    };
    const fire = async (el: Element) => {
      const tool = el.getAttribute("hx-tool")!;
      el.setAttribute("aria-busy", "true");
      el.removeAttribute("p-error");
      try {
        const r = await t.call("p_call", { tool, args: argsOf(el), _pid: pid, _since: since });
        apply(r.structuredContent?.patches);
        if (el instanceof HTMLFormElement && !el.hasAttribute("p-keep-values")) el.reset();
        if (el.hasAttribute("p-close")) (el.closest("[popover]") as any)?.hidePopover?.();
        el.dispatchEvent(new CustomEvent("p:done", { bubbles: true, detail: r.structuredContent?.result }));
      } catch (e: any) {
        el.setAttribute("p-error", e?.message ?? "error");
        el.dispatchEvent(new CustomEvent("p:error", { bubbles: true, detail: e }));
      } finally { el.removeAttribute("aria-busy"); }
    };
    const dflt = (el: Element) => el instanceof HTMLFormElement ? "submit" : el.matches("input,select,textarea") ? "change" : "click";
    const timers = new WeakMap<Element, number>();
    for (const type of ["click", "submit", "change", "input"]) {
      document.addEventListener(type, (e) => {
        const el = (e.target as Element).closest?.("[hx-tool]");
        if (!el || (el.getAttribute("hx-trigger") ?? dflt(el)) !== type || el.getAttribute("aria-busy")) return;
        if (type === "submit" || type === "click") e.preventDefault();
        const d = +(el.getAttribute("p-debounce") ?? 0);
        if (!d) return void fire(el);
        clearTimeout(timers.get(el));
        timers.set(el, setTimeout(() => fire(el), d) as unknown as number);
      });
    }
    document.querySelectorAll('[hx-trigger="load"]').forEach(fire);
  }

  if (t.stream) t.stream(pid, () => since, apply);
  else (async () => {
    for (let wait = 500; ;) {
      try {
        apply((await t.call("p_sync", { _pid: pid, _since: since })).structuredContent?.patches);
        wait = 500;
      } catch (e: any) {
        if (/re-mount/.test(e?.message)) return location.reload();
        await new Promise((r) => setTimeout(r, (wait = Math.min(wait * 2, 10_000))));
      }
    }
  })();
}
