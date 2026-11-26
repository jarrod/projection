// Browser runtime. Holds one thing: the view params. It morphs server HTML, turns events into tool calls, and checks for changes on a cadence.
// Attributes: hx-tool, hx-vals, hx-trigger (click|submit|change|input), p-set, p-debounce, p-close, p-keep, p-keep-values.
import { morph, changed } from "./morph.js";

export interface Transport { call(tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<any> }
export type State = { h?: string; poll?: number };

const tpl = (s: string) => { const t = document.createElement("template"); t.innerHTML = s; return t.content.firstElementChild!; };

export function start(t: Transport, { h, poll: gap = 5000 }: State = {}) {
  let params: Record<string, unknown> = {}, gen = 0, poll: AbortController | undefined;
  const ready = () => document.documentElement.setAttribute("p-ready", "");

  const apply = (html: string) => {
    const el = document.getElementById("p-root");
    if (!el) return document.body.insertAdjacentHTML("afterbegin", html);
    changed.clear();
    morph(el, tpl(html));
    // highlight only the rows/cards that actually changed
    changed.forEach((c) => {
      const t = c.closest("tr,li,.stat,[p-flash]");
      if (t && !t.closest("thead")) { t.setAttribute("p-updated", ""); setTimeout(() => t.removeAttribute("p-updated"), 900); }
    });
  };

  // One check at a time, every `gap` ms while the page is visible; failures back off up to a minute.
  // Starting a new loop (an action, a param change, the tab showing again) cancels the old one and checks at once.
  const loop = async (g: number) => {
    poll?.abort();
    const { signal } = (poll = new AbortController());
    for (let wait = gap; g === gen && !document.hidden; await new Promise((r) => setTimeout(r, wait))) {
      try {
        const r = (await t.call("p_sync", { params, h }, signal)).structuredContent;
        if (g !== gen) return;
        wait = gap;
        if (r.html) { h = r.h; apply(r.html); }
        ready();
      } catch {
        if (g !== gen) return;
        wait = Math.min(wait * 2, 60_000);
      }
    }
  };

  const argsOf = (el: Element) => {
    const form = el.closest("form");
    const a: Record<string, unknown> = {};
    if (form && el.matches("form,[type=submit],button:not([type])")) {
      Object.assign(a, Object.fromEntries(new FormData(form)));
      // FormData gives "on" for a ticked box and nothing for an unticked one: send booleans, as a lone Checkbox does.
      form.querySelectorAll<HTMLInputElement>("[type=checkbox][name]:enabled").forEach((c) => (a[c.name] = c.checked));
    }
    const name = el.getAttribute("name");
    if (name && "value" in el) a[name] = (el as HTMLInputElement).type === "checkbox" ? (el as HTMLInputElement).checked : (el as HTMLInputElement).value;
    const vals = el.getAttribute("hx-vals");
    return vals ? { ...a, ...JSON.parse(vals) } : a;
  };
  const close = (el: Element) => el.hasAttribute("p-close") && (el.closest("[popover]") as any)?.hidePopover?.();
  const fire = async (el: Element) => {
    const tool = el.getAttribute("hx-tool");
    if (!tool) { // p-set: change the view params and render again
      params = { ...params, ...argsOf(el) };
      close(el);
      return loop(++gen);
    }
    // The message shows before the element, so for a field it goes on the label around it (an input draws no ::before).
    const at = el.closest("label") ?? el, c = el as any;
    el.setAttribute("aria-busy", "true");
    at.removeAttribute("p-error");
    try {
      await t.call(tool, argsOf(el));
      if (c.reset && !el.hasAttribute("p-keep-values")) c.reset();
      close(el);
      loop(++gen); // show the result of our own action at once
    } catch (e: any) {
      // The call failed, so the control goes back to what the server last rendered.
      if (c.type === "checkbox") c.checked = c.defaultChecked;
      for (const o of c.options ?? []) o.selected = o.defaultSelected;
      at.setAttribute("p-error", e?.message ?? "error");
    }
    finally { el.removeAttribute("aria-busy"); }
  };
  const dflt = (el: Element) => el.matches("form") ? "submit" : el.matches("input,select,textarea") ? "change" : "click";
  const timers = new WeakMap<Element, number>();
  for (const type of ["click", "submit", "change", "input"]) {
    document.addEventListener(type, (e) => {
      const el = (e.target as Element).closest?.("[hx-tool],[p-set]");
      if (!el || (el.getAttribute("hx-trigger") ?? dflt(el)) !== type) return;
      // Always stop a native submit, also while busy. A click that opens a popover keeps its default, or the popover never opens.
      if (type === "submit" || (type === "click" && !el.hasAttribute("popovertarget"))) e.preventDefault();
      if (el.getAttribute("aria-busy")) return;
      const d = +(el.getAttribute("p-debounce") ?? 0);
      if (!d) return void fire(el);
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => fire(el), d) as unknown as number);
    });
  }

  // No checks in a hidden tab; one at once when it shows again.
  document.onvisibilitychange = () => loop(++gen);
  if (h) ready();
  loop(gen);
}
