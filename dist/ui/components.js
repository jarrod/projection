// Server-side components: plain functions that return escaped HTML. Nothing here ships to the browser.
import { html, attrs, cx, raw } from "../html.js";
const tone = (t) => (t && t !== "neutral" ? t : "");
const act = (a) => ({
    "hx-tool": a.tool, "p-set": !a.tool && !!a.set,
    "hx-vals": a.tool ? a.args : a.set === true ? undefined : a.set, "p-close": a.close && !!(a.tool || a.set),
});
// ---------- icons (inline, 1.5 stroke) ----------
const P = {
    plus: "M8 3v10M3 8h10", check: "m3.5 8.5 3 3 6-7", x: "m4 4 8 8M12 4l-8 8", more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
    chevron: "m6 4 4 4-4 4", down: "m4 6 4 4 4-4", search: "m13 13-2.6-2.6M11.5 7a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z",
    trash: "M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5", pin: "M6 2.5h4M7 2.5v4L4.5 9h7L9 6.5v-4M8 9v4.5",
    external: "M9.5 2.5h4v4M13.5 2.5 7 9M12 9.5v4H2.5V4h4", refresh: "M13 8a5 5 0 1 1-1.5-3.5M13 3v2.5h-2.5",
    sun: "M8 1.5V3M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
    moon: "M13.5 9.5a5.5 5.5 0 1 1-7-7 4.5 4.5 0 0 0 7 7Z", monitor: "M2 3h12v8H2zM5.5 14h5M8 11v3",
};
const paths = P;
/** Inline 16 px icon in the current text colour. Unknown names render nothing. */
export const Icon = (name) => raw(`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${Object.hasOwn(paths, name) ? paths[name] : ""}"/></svg>`);
// ---------- layout ----------
/** Vertical stack. `gap` in px (default 12). */
export const Stack = (p = {}, ...c) => html `<div class="stack"${attrs({ style: p.gap != null && `--gap:${p.gap}px` })}>${c}</div>`;
/** Horizontal row that wraps. `gap` in px (default 8); `between` pushes children to the two ends. */
export const Row = (p = {}, ...c) => html `<div class="${cx("row", p.between && "between")}"${attrs({ style: p.gap != null && `--gap:${p.gap}px` })}>${c}</div>`;
/** Responsive grid: as many columns as fit, each at least `min` px wide (default 180). `gap` in px (default 12). */
export const Grid = (p = {}, ...c) => html `<div class="grid"${attrs({ style: [p.min && `--min:${p.min}px`, p.gap != null && `--gap:${p.gap}px`].filter(Boolean).join(";") || null })}>${c}</div>`;
/** Horizontal rule. */
export const Separator = () => html `<hr class="sep">`;
/** Page header with title, description and actions on the right. */
export const Header = (p) => html `<header class="hdr"><div><h1>${p.title}</h1>${p.description != null && html `<p>${p.description}</p>`}</div>${p.actions != null && html `<div class="row">${p.actions}</div>`}</header>`;
/** Button. Calls `tool`, sets params with `set`, or opens a Dialog/Menu with `opens`. A plain Button inside a Form submits it.
 *  `variant` defaults to primary: use one primary per view, ghost for row actions, danger for destructive confirms. */
export function Button(p, ...c) {
    const iconOnly = !c.length && !!p.icon;
    return html `<button${attrs({
        id: p.id,
        class: cx("btn", p.variant && p.variant !== "primary" && p.variant, p.size === "sm" && "sm", iconOnly && "icon"),
        type: p.type ?? (p.tool || p.set || p.opens ? "button" : undefined),
        disabled: p.disabled, "aria-label": iconOnly ? p.label : undefined, title: iconOnly ? p.label : undefined,
        popovertarget: p.opens, ...act(p),
    })}>${p.icon && Icon(p.icon)}${c}</button>`;
}
/** Form that calls a tool with its fields as arguments on submit. */
export const Form = (p, ...c) => html `<form${attrs({ id: p.id, class: "stack", "p-keep-values": p.keepValues, ...act(p) })}>${c}</form>`;
const field = (p, control) => p.label || p.hint ? html `<label class="field">${p.label && html `<span>${p.label}</span>`}${control}${p.hint && html `<small>${p.hint}</small>`}</label>` : control;
const ctl = (p) => ({
    name: p.name, required: p.required, placeholder: p.placeholder, disabled: p.disabled,
    ...act(p), "hx-trigger": (p.tool || p.set) && p.debounce != null ? "input" : undefined, "p-debounce": (p.tool || p.set) && p.debounce,
});
/** Text input. With `tool`, a change calls it with { [name]: string } plus args; with `set: true`, it sets that param. */
export const Input = (p) => field(p, html `<input class="input"${attrs({ type: p.type ?? "text", value: p.value, autofocus: p.autofocus, autocomplete: "off", ...ctl(p) })}>`);
/** Multi-line text input. Behaves like Input. */
export const Textarea = (p) => field(p, html `<textarea class="input"${attrs({ rows: p.rows, ...ctl(p) })}>${p.value}</textarea>`);
/** Dropdown. With `tool`, a change calls it with { [name]: string } plus args; with `set: true`, it sets that param. */
export const Select = (p) => field(p, html `<select class="input"${attrs(ctl(p))}>${p.options.map((o) => {
    const v = typeof o === "string" ? o : o.value;
    return html `<option${attrs({ value: v, selected: v === p.value })}>${typeof o === "string" ? o : o.label}</option>`;
})}</select>`);
/** Checkbox or switch. With `tool`, toggling calls it with { [name]: boolean } plus args. */
export const Checkbox = (p) => html `<label class="check"><input type="checkbox"${attrs({ checked: p.checked, role: p.switch && "switch", ...ctl(p) })}>${p.label}</label>`;
// ---------- display ----------
/** Small status label. `tone` colours it; `dot` adds a leading dot; `outline` drops the fill. */
export const Badge = (p = {}, ...c) => html `<span class="${cx("badge", tone(p.tone), p.outline && "outline")}">${p.dot && html `<i class="dot"></i>`}${c}</span>`;
/** Status dot. `pulse` animates it (running, live). Give it a `label`: it has no text of its own. */
export const Dot = (p = {}) => html `<span${attrs({ class: cx("dot", tone(p.tone), p.pulse && "pulse"), role: p.label && "img", "aria-label": p.label })}></span>`;
/** Keyboard key, such as a shortcut hint. */
export const Kbd = (k) => html `<kbd>${k}</kbd>`;
/** Secondary text in a quieter colour. */
export const Muted = (...c) => html `<span class="muted">${c}</span>`;
/** Monospace text, for ids, numbers and timestamps. */
export const Mono = (...c) => html `<span class="mono">${c}</span>`;
/** Bordered section with an optional header (title, description, actions on the right) and footer.
 *  `flush` removes the body padding, for wrapping a Table. */
export const Card = (p = {}, ...c) => html `<section${attrs({ class: "card", id: p.id })}>${(p.title || p.actions != null) && html `<header><div>${p.title && html `<h3>${p.title}</h3>`}${p.description != null && html `<p>${p.description}</p>`}</div>${p.actions != null && html `<div class="row">${p.actions}</div>`}</header>`}<div class="${cx("body", p.flush && "flush")}">${c}</div>${p.footer != null && html `<footer>${p.footer}</footer>`}</section>`;
/** One number with a label, for an overview Grid. `delta` is a small note under the value ("+3 today"); `tone` colours it. */
export const Stat = (p) => html `<div class="${cx("stat", tone(p.tone))}"><span>${p.label}</span><strong>${p.value}</strong>${p.delta && html `<small>${p.delta}</small>`}</div>`;
/** Data table. Give `id` + `rowKey` so rows morph in place (keeps hover/focus, animates only changed rows). */
export function Table(p) {
    if (!p.rows.length && p.empty != null)
        return html `${p.empty}`;
    return html `<div class="tbl-wrap"><table class="tbl"${attrs({ id: p.id })}><thead><tr>${p.columns.map((c) => html `<th${attrs({ class: cx(c.align === "right" && "r"), style: c.width && `width:${c.width}` })}>${c.label}</th>`)}</tr></thead><tbody>${p.rows.map((r) => html `<tr${attrs({ id: p.id && p.rowKey ? `${p.id}-${p.rowKey(r)}` : undefined })}>${p.columns.map((c) => html `<td${attrs({ class: cx(c.align === "right" && "r", c.mono && "mono") || undefined })}>${c.cell ? c.cell(r) : c.key != null ? r[c.key] : ""}</td>`)}</tr>`)}</tbody></table></div>`;
}
/** Empty state: what's missing and how to fill it. `action` is shown below, usually a Button. Pass it as a Table's `empty`. */
export const Empty = (p) => html `<div class="empty">${p.icon && html `<span class="subtle">${Icon(p.icon)}</span>`}<h3>${p.title}</h3>${p.description != null && html `<p>${p.description}</p>`}${p.action}</div>`;
/** Grey placeholder lines while something loads. */
export const Skeleton = (p = {}) => html `<div class="stack" style="--gap:8px" aria-hidden="true">${Array.from({ length: p.lines ?? 3 }, (_, i) => html `<i class="skel" style="width:${i === (p.lines ?? 3) - 1 ? "60%" : p.width ?? "100%"}"></i>`)}</div>`;
// ---------- client-side interactivity (native: radios + popover API) ----------
/** Tabs. Selection lives in the browser and survives live updates. Up to 6 tabs. */
export const Tabs = (p) => html `<div class="tabs" id="${p.id}">${p.tabs.map((t, i) => html `<input type="radio" name="${p.id}" id="${p.id}-${i}"${attrs({ checked: i === (p.selected ?? 0) })}><label for="${p.id}-${i}">${t.label}</label>`)}${p.tabs.map((t) => html `<div class="panel">${t.content}</div>`)}</div>`;
/** System / light / dark switch. Pure CSS: the choice lives in this browser tab and survives live updates.
 *  Hidden inside MCP hosts that set a theme, since the host owns it there. Use once per view. */
export const ThemeToggle = () => html `<div class="mode" role="radiogroup" aria-label="Theme">${["system", "light", "dark"].map((m) => html `<input type="radio" name="p-mode" id="p-mode-${m}" aria-label="${m}"${attrs({ checked: m === "system" })}><label for="p-mode-${m}" title="${m}">${Icon(m === "system" ? "monitor" : m === "light" ? "sun" : "moon")}</label>`)}</div>`;
/** Modal dialog. Open it with Button({ opens: id }). Put a Form({ tool, close: true }) inside for actions. */
export const Dialog = (p, ...c) => html `<div class="dialog" popover tabindex="-1" autofocus id="${p.id}" role="dialog" aria-labelledby="${p.id}-t"><h2 id="${p.id}-t">${p.title}</h2>${p.description != null && html `<p>${p.description}</p>`}<div class="stack">${c}</div></div>`;
/** Cancel button for dialogs. */
export const Close = (target, label = "Cancel") => html `<button type="button" class="btn secondary" popovertarget="${target}" popovertargetaction="hide">${label}</button>`;
/** Dropdown menu anchored to its trigger. Trigger it with Button({ opens: id }). */
export const Menu = (p) => html `<div class="menu" popover id="${p.id}">${p.items.map((it) => it === "-" ? html `<hr>` :
    it.href && /^(https?:|mailto:|[/#?.])/i.test(it.href) ? html `<a${attrs({ href: it.href, target: "_blank", rel: "noopener" })}>${it.icon && Icon(it.icon)}${it.label}</a>` :
        html `<button type="button"${attrs({ class: it.danger && "bad", ...act({ ...it, close: it.close ?? true }) })}>${it.icon && Icon(it.icon)}${it.label}${it.kbd && Kbd(it.kbd)}</button>`)}</div>`;
