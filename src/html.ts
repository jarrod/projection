/** Escaped HTML string. Produced by `html` tagged templates and components. */
export type Html = { readonly __html: string };

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const NEEDS = /[&<>"']/;
const ALL = /[&<>"']/g;

export const esc = (v: unknown): string => {
  const s = String(v);
  return NEEDS.test(s) ? s.replace(ALL, (c) => ESC[c]) : s;
};

/** Mark a string as trusted HTML. Never pass user input. */
export const raw = (s: string): Html => ({ __html: s });
export const isHtml = (v: unknown): v is Html => typeof v === "object" && v !== null && "__html" in v;

const flat = (v: unknown): string =>
  v == null || v === false || v === true ? "" :
  Array.isArray(v) ? v.map(flat).join("") :
  isHtml(v) ? v.__html :
  esc(v);

/** Tagged template: interpolations are escaped, nested `html`/arrays are inlined. */
export function html(strings: TemplateStringsArray, ...vals: unknown[]): Html {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += flat(vals[i]) + strings[i + 1];
  return { __html: out };
}

/** Render attributes: true → bare attr, false/null → omitted, objects → JSON. */
export function attrs(o: Record<string, unknown>): Html {
  let out = "";
  for (const k in o) {
    const v = o[k];
    if (v == null || v === false) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(typeof v === "object" ? JSON.stringify(v) : v)}"`;
  }
  return { __html: out };
}

/** Join class names, dropping falsy values. */
export const cx = (...c: unknown[]) => c.filter(Boolean).join(" ");
