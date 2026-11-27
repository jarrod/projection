/** Escaped HTML string. Produced by `html` tagged templates and components. */
export type Html = {
    readonly __html: string;
};
export declare const esc: (v: unknown) => string;
/** Mark a string as trusted HTML. Never pass user input. */
export declare const raw: (s: string) => Html;
export declare const isHtml: (v: unknown) => v is Html;
/** Tagged template: interpolations are escaped, nested `html`/arrays are inlined. */
export declare function html(strings: TemplateStringsArray, ...vals: unknown[]): Html;
/** Render attributes: true → bare attr, false/null → omitted, objects → JSON. */
export declare function attrs(o: Record<string, unknown>): Html;
/** Join class names, dropping falsy values. */
export declare const cx: (...c: unknown[]) => string;
