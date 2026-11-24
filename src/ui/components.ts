// Server-side components: plain functions that return escaped HTML. Nothing here ships to the browser.
import { html, attrs, cx, raw, type Html } from "../html.js";

type Kids = unknown[];
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info";
const tone = (t?: Tone) => (t && t !== "neutral" ? t : "");

/** Action props shared by anything that can call a tool. */
export type Action = {
  /** MCP tool to call: the same one the agent calls. */
  tool?: string;
  /** Extra arguments merged into the tool call. */
  args?: Record<string, unknown>;
  /** Instead of a tool: merge these into the view params and render again (open a row, switch page, sort).
   *  `true` on an Input/Select/Form sets its own fields (search boxes, filters). */
  set?: Record<string, unknown> | true;
  /** Close the surrounding dialog/menu after success. */
  close?: boolean;
};
const act = (a: Action) => ({
  "hx-tool": a.tool, "p-set": !a.tool && !!a.set,
  "hx-vals": a.tool ? a.args : a.set === true ? undefined : a.set, "p-close": a.close && !!(a.tool || a.set),
});

// ---------- icons (inline, 1.5 stroke) ----------
const P: Record<string, string> = {
  plus: "M8 3v10M3 8h10", check: "m3.5 8.5 3 3 6-7", x: "m4 4 8 8M12 4l-8 8", more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  chevron: "m6 4 4 4-4 4", down: "m4 6 4 4 4-4", search: "m13 13-2.6-2.6M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z",
  trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5", pin: "M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5",
  external: "M9.5 2.5h4v4M13.5 2.5 7 9M12 9.5v4H2.5V4h4", refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5",
  sun: "M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  moon: "M13.5 9.5a5.5 5.5 0 1 1-7-7 4.5 4.5 0 0 0 7 7Z", monitor: "M2 3h12v8H2zM5.5 14h5M8 11v3",
};
export type IconName = keyof typeof P;
export const Icon = (name: IconName | string) =>
  raw(`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] ?? ""}"/></svg>`);

// ---------- layout ----------
export const Stack = (p: { gap?: number } = {}, ...c: Kids) => html`<div class="stack"${attrs({ style: p.gap != null && `--gap:${p.gap}px` })}>${c}</div>`;
export const Row = (p: { gap?: number; between?: boolean } = {}, ...c: Kids) =>
  html`<div class="${cx("row", p.between && "between")}"${attrs({ style: p.gap != null && `--gap:${p.gap}px` })}>${c}</div>`;
export const Grid = (p: { min?: number; gap?: number } = {}, ...c: Kids) =>
  html`<div class="grid"${attrs({ style: [p.min && `--min:${p.min}px`, p.gap != null && `--gap:${p.gap}px`].filter(Boolean).join(";") || null })}>${c}</div>`;
export const Separator = () => html`<hr class="sep">`;

/** Page header with title, description and actions on the right. */
export const Header = (p: { title: string; description?: unknown; actions?: unknown }) =>
  html`<header class="hdr"><div><h1>${p.title}</h1>${p.description != null && html`<p>${p.description}</p>`}</div>${p.actions != null && html`<div class="row">${p.actions}</div>`}</header>`;

// ---------- controls ----------
export type ButtonProps = Action & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  icon?: IconName;
  /** Icon-only button; pass a label for accessibility. */
  label?: string;
  /** Open or toggle the popover (Dialog/Menu) with this id. */
  opens?: string;
  type?: "button" | "submit";
  disabled?: boolean;
  id?: string;
};
export function Button(p: ButtonProps, ...c: Kids): Html {
  const iconOnly = !c.length && !!p.icon;
  return html`<button${attrs({
    id: p.id,
    class: cx("btn", p.variant && p.variant !== "primary" && p.variant, p.size === "sm" && "sm", iconOnly && "icon"),
    type: p.type ?? (p.tool || p.set || p.opens ? "button" : undefined),
    disabled: p.disabled, "aria-label": iconOnly ? p.label : undefined, title: iconOnly ? p.label : undefined,
    popovertarget: p.opens, ...act(p),
  })}>${p.icon && Icon(p.icon)}${c}</button>`;
}

/** Form that calls a tool with its fields as arguments on submit. */
export const Form = (p: Action & { id?: string; keepValues?: boolean }, ...c: Kids) =>
  html`<form${attrs({ id: p.id, class: "stack", "p-keep-values": p.keepValues, ...act(p) })}>${c}</form>`;

type FieldProps = { name: string; label?: string; hint?: string; required?: boolean; placeholder?: string; disabled?: boolean } & Action & {
  /** With `tool` or `set`: act on every keystroke after this many ms (search boxes). */
  debounce?: number;
};
const field = (p: FieldProps, control: Html) =>
  p.label || p.hint ? html`<label class="field">${p.label && html`<span>${p.label}</span>`}${control}${p.hint && html`<small>${p.hint}</small>`}</label>` : control;
const ctl = (p: FieldProps) => ({
  name: p.name, required: p.required, placeholder: p.placeholder, disabled: p.disabled,
  ...act(p), "hx-trigger": (p.tool || p.set) && p.debounce != null ? "input" : undefined, "p-debounce": (p.tool || p.set) && p.debounce,
});

export const Input = (p: FieldProps & { type?: string; value?: unknown; autofocus?: boolean }) =>
  field(p, html`<input class="input"${attrs({ type: p.type ?? "text", value: p.value, autofocus: p.autofocus, autocomplete: "off", ...ctl(p) })}>`);
export const Textarea = (p: FieldProps & { value?: unknown; rows?: number }) =>
  field(p, html`<textarea class="input"${attrs({ rows: p.rows, ...ctl(p) })}>${p.value}</textarea>`);
export const Select = (p: FieldProps & { value?: string; options: (string | { value: string; label: string })[] }) =>
  field(p, html`<select class="input"${attrs(ctl(p))}>${p.options.map((o) => {
    const v = typeof o === "string" ? o : o.value;
    return html`<option${attrs({ value: v, selected: v === p.value })}>${typeof o === "string" ? o : o.label}</option>`;
  })}</select>`);
/** Checkbox or switch. With `tool`, toggling calls it with { [name]: boolean } plus args. */
export const Checkbox = (p: Omit<FieldProps, "placeholder"> & { checked?: boolean; switch?: boolean }) =>
  html`<label class="check"><input type="checkbox"${attrs({ checked: p.checked, role: p.switch && "switch", ...ctl(p) })}>${p.label}</label>`;

// ---------- display ----------
export const Badge = (p: { tone?: Tone; outline?: boolean; dot?: boolean } = {}, ...c: Kids) =>
  html`<span class="${cx("badge", tone(p.tone), p.outline && "outline")}">${p.dot && html`<i class="dot"></i>`}${c}</span>`;
export const Dot = (p: { tone?: Tone; pulse?: boolean; label?: string } = {}) =>
  html`<span${attrs({ class: cx("dot", tone(p.tone), p.pulse && "pulse"), role: p.label && "img", "aria-label": p.label })}></span>`;
export const Kbd = (k: string) => html`<kbd>${k}</kbd>`;
export const Muted = (...c: Kids) => html`<span class="muted">${c}</span>`;
export const Mono = (...c: Kids) => html`<span class="mono">${c}</span>`;

export const Card = (p: { title?: string; description?: unknown; actions?: unknown; footer?: unknown; flush?: boolean; id?: string } = {}, ...c: Kids) =>
  html`<section${attrs({ class: "card", id: p.id })}>${(p.title || p.actions != null) && html`<header><div>${p.title && html`<h3>${p.title}</h3>`}${p.description != null && html`<p>${p.description}</p>`}</div>${p.actions != null && html`<div class="row">${p.actions}</div>`}</header>`}<div class="${cx("body", p.flush && "flush")}">${c}</div>${p.footer != null && html`<footer>${p.footer}</footer>`}</section>`;

export const Stat = (p: { label: string; value: unknown; delta?: string; tone?: Tone }) =>
  html`<div class="${cx("stat", tone(p.tone))}"><span>${p.label}</span><strong>${p.value}</strong>${p.delta && html`<small>${p.delta}</small>`}</div>`;

export type Column<T> = { label: string; key?: keyof T; cell?: (row: T) => unknown; align?: "left" | "right"; mono?: boolean; width?: string };
/** Data table. Give `id` + `rowKey` so rows morph in place (keeps hover/focus, animates only changed rows). */
export function Table<T>(p: { id?: string; rows: T[]; columns: Column<T>[]; rowKey?: (r: T) => string | number; empty?: unknown }): Html {
  if (!p.rows.length && p.empty != null) return html`${p.empty}`;
  return html`<div class="tbl-wrap"><table class="tbl"${attrs({ id: p.id })}><thead><tr>${p.columns.map((c) =>
    html`<th${attrs({ class: cx(c.align === "right" && "r"), style: c.width && `width:${c.width}` })}>${c.label}</th>`)}</tr></thead><tbody>${p.rows.map((r) =>
    html`<tr${attrs({ id: p.id && p.rowKey ? `${p.id}-${p.rowKey(r)}` : undefined })}>${p.columns.map((c) =>
      html`<td${attrs({ class: cx(c.align === "right" && "r", c.mono && "mono") || undefined })}>${c.cell ? c.cell(r) : c.key != null ? (r[c.key] as unknown) : ""}</td>`)}</tr>`)}</tbody></table></div>`;
}

export const Empty = (p: { title: string; description?: unknown; action?: unknown; icon?: IconName }) =>
  html`<div class="empty">${p.icon && html`<span class="subtle">${Icon(p.icon)}</span>`}<h3>${p.title}</h3>${p.description != null && html`<p>${p.description}</p>`}${p.action}</div>`;
export const Skeleton = (p: { lines?: number; width?: string } = {}) =>
  html`<div class="stack" style="--gap:8px" aria-hidden="true">${Array.from({ length: p.lines ?? 3 }, (_, i) => html`<i class="skel" style="width:${i === (p.lines ?? 3) - 1 ? "60%" : p.width ?? "100%"}"></i>`)}</div>`;

// ---------- client-side interactivity (native: radios + popover API) ----------
/** Tabs. Selection lives in the browser and survives live updates. Up to 6 tabs. */
export const Tabs = (p: { id: string; tabs: { label: unknown; content: unknown }[]; selected?: number }) =>
  html`<div class="tabs" id="${p.id}">${p.tabs.map((t, i) =>
    html`<input type="radio" name="${p.id}" id="${p.id}-${i}"${attrs({ checked: i === (p.selected ?? 0) })}><label for="${p.id}-${i}">${t.label}</label>`)}${p.tabs.map((t) =>
    html`<div class="panel">${t.content}</div>`)}</div>`;

/** System / light / dark switch. Pure CSS: the choice lives in this browser tab and survives live updates.
 *  Hidden inside MCP hosts that set a theme, since the host owns it there. Use once per view. */
export const ThemeToggle = () =>
  html`<div class="mode" role="radiogroup" aria-label="Theme">${(["system", "light", "dark"] as const).map((m) =>
    html`<input type="radio" name="p-mode" id="p-mode-${m}" aria-label="${m}"${attrs({ checked: m === "system" })}><label for="p-mode-${m}" title="${m}">${Icon(m === "system" ? "monitor" : m === "light" ? "sun" : "moon")}</label>`)}</div>`;

/** Modal dialog. Open it with Button({ opens: id }). Put a Form({ tool, close: true }) inside for actions. */
export const Dialog = (p: { id: string; title: string; description?: unknown }, ...c: Kids) =>
  html`<div class="dialog" popover id="${p.id}" role="dialog" aria-labelledby="${p.id}-t"><h2 id="${p.id}-t">${p.title}</h2>${p.description != null && html`<p>${p.description}</p>`}<div class="stack">${c}</div></div>`;
/** Cancel button for dialogs. */
export const Close = (target: string, label = "Cancel") =>
  html`<button type="button" class="btn secondary" popovertarget="${target}" popovertargetaction="hide">${label}</button>`;

export type MenuItem = (Action & { label: string; icon?: IconName; kbd?: string; danger?: boolean; href?: string }) | "-";
/** Dropdown menu anchored to its trigger. Trigger it with Button({ opens: id }). */
export const Menu = (p: { id: string; items: MenuItem[] }) =>
  html`<div class="menu" popover id="${p.id}" role="menu">${p.items.map((it) =>
    it === "-" ? html`<hr>` :
    it.href ? html`<a role="menuitem"${attrs({ href: it.href, target: "_blank", rel: "noopener" })}>${it.icon && Icon(it.icon)}${it.label}</a>` :
    html`<button type="button" role="menuitem"${attrs({ class: it.danger && "bad", ...act({ ...it, close: it.close ?? true }) })}>${it.icon && Icon(it.icon)}${it.label}${it.kbd && Kbd(it.kbd)}</button>`)}</div>`;
