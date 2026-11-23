// Browser runtime. Holds one thing: the view params. It morphs server HTML, turns events into tool calls, and asks again when data changes.
// Attributes: hx-tool, hx-vals, hx-trigger (click|submit|change|input), p-set, p-debounce, p-close, p-keep, p-keep-values.
import { morph, changed } from "./morph.js";

export interface Transport { call(tool: string, args: Record<string, unknown>): Promise<any> }
export type State = { h?: string; v?: number };

const tpl = (s: string) => { const t = document.createElement("template"); t.innerHTML = s; return t.content.firstElementChild!; };

export function start(t: Transport, { h, v }: State = {}) {
  let params: Record<string, unknown> = {}, gen = 0;
  const ready = () => document.documentElement.setAttribute("p-ready", "");

  const apply = (html: string) => {
    const el = document.getElementById("p-root");
    if (!el) return document.body.insertAdjacentHTML("afterbegin", html);
    changed.clear();
    morph(el, tpl(html));
    // highlight only the rows/cards that actually changed
    const hit = new Set<Element>();
    changed.forEach((c) => { const t = c.closest("tr,li,.stat,[p-flash]"); if (t && !t.closest("thead")) hit.add(t); });
    hit.forEach((t) => { t.setAttribute("p-updated", ""); setTimeout(() => t.removeAttribute("p-updated"), 900); });
  };

  // One long-poll at a time. The server answers at once if we are behind (or v is unset), otherwise when something changes.
  const loop = async (g: number) => {
    for (let wait = 500; g === gen; ) {
      try {
        const r = (await t.call("p_sync", { params, h, v })).structuredContent;
        if (g !== gen) return;
        wait = 500; v = r.v;
        if (r.html) { h = r.h; apply(r.html); }
        ready();
      } catch { await new Promise((r) => setTimeout(r, (wait = Math.min(wait * 2, 10_000)))); }
    }
  };

  const argsOf = (el: Element) => {
    const form = el instanceof HTMLFormElement ? el : el.closest("form");
    const a: Record<string, unknown> = form && el.matches("form,[type=submit],button:not([type])") ? Object.fromEntries(new FormData(form)) : {};
    const name = el.getAttribute("name");
    if (name && "value" in el) a[name] = (el as HTMLInputElement).type === "checkbox" ? (el as HTMLInputElement).checked : (el as HTMLInputElement).value;
    const vals = el.getAttribute("hx-vals");
    return vals ? { ...a, ...JSON.parse(vals) } : a;
  };
  const close = (el: Element) => el.hasAttribute("p-close") && (el.closest("[popover]") as any)?.hidePopover?.();
  const fire = async (el: Element) => {
    const tool = el.getAttribute("hx-tool");
    if (!tool) { // p-set: change the view params and render again
      params = { ...params, ...argsOf(el) }; v = undefined;
      close(el);
      return loop(++gen);
    }
    el.setAttribute("aria-busy", "true");
    el.removeAttribute("p-error");
    try {
      await t.call(tool, argsOf(el)); // the open poll returns with the new HTML
      if (el instanceof HTMLFormElement && !el.hasAttribute("p-keep-values")) el.reset();
      close(el);
    } catch (e: any) { el.setAttribute("p-error", e?.message ?? "error"); }
    finally { el.removeAttribute("aria-busy"); }
  };
  const dflt = (el: Element) => el instanceof HTMLFormElement ? "submit" : el.matches("input,select,textarea") ? "change" : "click";
  const timers = new WeakMap<Element, number>();
  for (const type of ["click", "submit", "change", "input"]) {
    document.addEventListener(type, (e) => {
      const el = (e.target as Element).closest?.("[hx-tool],[p-set]");
      if (!el || (el.getAttribute("hx-trigger") ?? dflt(el)) !== type || el.getAttribute("aria-busy")) return;
      if (type === "submit" || type === "click") e.preventDefault();
      const d = +(el.getAttribute("p-debounce") ?? 0);
      if (!d) return void fire(el);
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => fire(el), d) as unknown as number);
    });
  }

  if (h) ready();
  loop(gen);
}
