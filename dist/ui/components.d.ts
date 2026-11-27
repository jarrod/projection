import { type Html } from "../html.js";
type Kids = unknown[];
export type Tone = "neutral" | "ok" | "warn" | "bad" | "info";
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
declare const P: {
    plus: string;
    check: string;
    x: string;
    more: string;
    chevron: string;
    down: string;
    search: string;
    trash: string;
    pin: string;
    external: string;
    refresh: string;
    sun: string;
    moon: string;
    monitor: string;
};
export type IconName = keyof typeof P;
/** Inline 16 px icon in the current text colour. Unknown names render nothing. */
export declare const Icon: (name: IconName | string) => Html;
/** Vertical stack. `gap` in px (default 12). */
export declare const Stack: (p?: {
    gap?: number;
}, ...c: Kids) => Html;
/** Horizontal row that wraps. `gap` in px (default 8); `between` pushes children to the two ends. */
export declare const Row: (p?: {
    gap?: number;
    between?: boolean;
}, ...c: Kids) => Html;
/** Responsive grid: as many columns as fit, each at least `min` px wide (default 180). `gap` in px (default 12). */
export declare const Grid: (p?: {
    min?: number;
    gap?: number;
}, ...c: Kids) => Html;
/** Horizontal rule. */
export declare const Separator: () => Html;
/** Page header with title, description and actions on the right. */
export declare const Header: (p: {
    title: string;
    description?: unknown;
    actions?: unknown;
}) => Html;
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
/** Button. Calls `tool`, sets params with `set`, or opens a Dialog/Menu with `opens`. A plain Button inside a Form submits it.
 *  `variant` defaults to primary: use one primary per view, ghost for row actions, danger for destructive confirms. */
export declare function Button(p: ButtonProps, ...c: Kids): Html;
/** Form that calls a tool with its fields as arguments on submit. */
export declare const Form: (p: Action & {
    id?: string;
    keepValues?: boolean;
}, ...c: Kids) => Html;
type FieldProps = {
    name: string;
    label?: string;
    hint?: string;
    required?: boolean;
    placeholder?: string;
    disabled?: boolean;
} & Action & {
    /** With `tool` or `set`: act on every keystroke after this many ms (search boxes). */
    debounce?: number;
};
/** Text input. With `tool`, a change calls it with { [name]: string } plus args; with `set: true`, it sets that param. */
export declare const Input: (p: FieldProps & {
    type?: string;
    value?: unknown;
    autofocus?: boolean;
}) => Html;
/** Multi-line text input. Behaves like Input. */
export declare const Textarea: (p: FieldProps & {
    value?: unknown;
    rows?: number;
}) => Html;
/** Dropdown. With `tool`, a change calls it with { [name]: string } plus args; with `set: true`, it sets that param. */
export declare const Select: (p: FieldProps & {
    value?: string;
    options: (string | {
        value: string;
        label: string;
    })[];
}) => Html;
/** Checkbox or switch. With `tool`, toggling calls it with { [name]: boolean } plus args. */
export declare const Checkbox: (p: Omit<FieldProps, "placeholder"> & {
    checked?: boolean;
    switch?: boolean;
}) => Html;
/** Small status label. `tone` colours it; `dot` adds a leading dot; `outline` drops the fill. */
export declare const Badge: (p?: {
    tone?: Tone;
    outline?: boolean;
    dot?: boolean;
}, ...c: Kids) => Html;
/** Status dot. `pulse` animates it (running, live). Give it a `label`: it has no text of its own. */
export declare const Dot: (p?: {
    tone?: Tone;
    pulse?: boolean;
    label?: string;
}) => Html;
/** Keyboard key, such as a shortcut hint. */
export declare const Kbd: (k: string) => Html;
/** Secondary text in a quieter colour. */
export declare const Muted: (...c: Kids) => Html;
/** Monospace text, for ids, numbers and timestamps. */
export declare const Mono: (...c: Kids) => Html;
/** Bordered section with an optional header (title, description, actions on the right) and footer.
 *  `flush` removes the body padding, for wrapping a Table. */
export declare const Card: (p?: {
    title?: string;
    description?: unknown;
    actions?: unknown;
    footer?: unknown;
    flush?: boolean;
    id?: string;
}, ...c: Kids) => Html;
/** One number with a label, for an overview Grid. `delta` is a small note under the value ("+3 today"); `tone` colours it. */
export declare const Stat: (p: {
    label: string;
    value: unknown;
    delta?: string;
    tone?: Tone;
}) => Html;
/** Table column: show `row[key]`, or whatever `cell(row)` returns. `width` is any CSS width; `mono` for ids and numbers. */
export type Column<T> = {
    label: string;
    key?: keyof T;
    cell?: (row: T) => unknown;
    align?: "left" | "right";
    mono?: boolean;
    width?: string;
};
/** Data table. Give `id` + `rowKey` so rows morph in place (keeps hover/focus, animates only changed rows). */
export declare function Table<T>(p: {
    id?: string;
    rows: T[];
    columns: Column<T>[];
    rowKey?: (r: T) => string | number;
    empty?: unknown;
}): Html;
/** Empty state: what's missing and how to fill it. `action` is shown below, usually a Button. Pass it as a Table's `empty`. */
export declare const Empty: (p: {
    title: string;
    description?: unknown;
    action?: unknown;
    icon?: IconName;
}) => Html;
/** Grey placeholder lines while something loads. */
export declare const Skeleton: (p?: {
    lines?: number;
    width?: string;
}) => Html;
/** Tabs. Selection lives in the browser and survives live updates. Up to 6 tabs. */
export declare const Tabs: (p: {
    id: string;
    tabs: {
        label: unknown;
        content: unknown;
    }[];
    selected?: number;
}) => Html;
/** System / light / dark switch. Pure CSS: the choice lives in this browser tab and survives live updates.
 *  Hidden inside MCP hosts that set a theme, since the host owns it there. Use once per view. */
export declare const ThemeToggle: () => Html;
/** Modal dialog. Open it with Button({ opens: id }). Put a Form({ tool, close: true }) inside for actions. */
export declare const Dialog: (p: {
    id: string;
    title: string;
    description?: unknown;
}, ...c: Kids) => Html;
/** Cancel button for dialogs. */
export declare const Close: (target: string, label?: string) => Html;
/** A menu entry, or "-" for a divider. With `href` (http(s), mailto or relative) it is a link that opens in a new tab;
 *  otherwise it acts like a Button and closes the menu after success. `danger` colours it red. */
export type MenuItem = (Action & {
    label: string;
    icon?: IconName;
    kbd?: string;
    danger?: boolean;
    href?: string;
}) | "-";
/** Dropdown menu anchored to its trigger. Trigger it with Button({ opens: id }). */
export declare const Menu: (p: {
    id: string;
    items: MenuItem[];
}) => Html;
export {};
