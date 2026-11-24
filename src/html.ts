/** Escaped HTML string. Produced by `html` tagged templates and components. */
export type Html = { readonly __html: string };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const NEEDS = /[&<>"']/;
const ALL = /[&<>"']/g;

export const esc = (v: unknown): string => {
  const s = String(v);
  return NEEDS.test(s) ? s.replace(ALL, (c) => ESC[c]) : s;
};

// The brand is a symbol, which JSON cannot carry: a { "__html": ... } object arriving in params or tool data is escaped like any value.
const TAG = Symbol.for("mcp-projection.html");
/** Mark a string as trusted HTML. Never pass user input. */
export const raw = (s: string): Html => ({ __html: s, [TAG]: true }) as Html;
export const isHtml = (v: unknown): v is Html => typeof v === "object" && v !== null && (v as any)[TAG] === true;

const flat = (v: unknown): string =>
  v == null || v === false || v === true ? "" :
  Array.isArray(v) ? v.map(flat).join("") :
  isHtml(v) ? v.__html :
  esc(v);

/** Tagged template: interpolations are escaped, nested `html`/arrays are inlined. */
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Html {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return raw(out);
}

/** Render attributes: true → bare attr, false/null → omitted, objects → JSON. */
export function attrs(o: Record<string, unknown>): Html {
  let out = "";
  for (const k in o) {
    const v = o[k];
    if (v == null || v === false || !/^[\w:.-]+$/.test(k)) continue; // a name with a space or quote would start a new attribute
    out += v === true ? ` ${k}` : ` ${k}="${esc(typeof v === "object" ? JSON.stringify(v) : v)}"`;
  }
  return raw(out);
}

/** Join class names, dropping falsy values. */
export const cx = (...c: unknown[]) => c.filter(Boolean).join(" ");
