const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const NEEDS = /[&<>"']/;
const ALL = /[&<>"']/g;
export const esc = (v) => {
    const s = String(v);
    return NEEDS.test(s) ? s.replace(ALL, (c) => ESC[c]) : s;
};
// The brand is a symbol, which JSON cannot carry: a { "__html": ... } object arriving in params or tool data is escaped like any value.
const TAG = Symbol.for("mcp-projector.html");
/** Mark a string as trusted HTML. Never pass user input. */
export const raw = (s) => ({ __html: s, [TAG]: true });
export const isHtml = (v) => typeof v === "object" && v !== null && v[TAG] === true;
const flat = (v) => v == null || v === false || v === true ? "" :
    Array.isArray(v) ? v.map(flat).join("") :
        isHtml(v) ? v.__html :
            esc(v);
/** Tagged template: interpolations are escaped, nested `html`/arrays are inlined. */
export function html(strings, ...vals) {
    let out = strings[0];
    for (let i = 0; i < vals.length; i++)
        out += flat(vals[i]) + strings[i + 1];
    return raw(out);
}
/** Render attributes: true → bare attr, false/null → omitted, objects → JSON. */
export function attrs(o) {
    let out = "";
    for (const k in o) {
        const v = o[k];
        if (v == null || v === false || !/^[\w:.-]+$/.test(k))
            continue; // a name with a space or quote would start a new attribute
        out += v === true ? ` ${k}` : ` ${k}="${esc(typeof v === "object" ? JSON.stringify(v) : v)}"`;
    }
    return raw(out);
}
/** Join class names, dropping falsy values. */
export const cx = (...c) => c.filter(Boolean).join(" ");
