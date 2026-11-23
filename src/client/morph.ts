// Tiny DOM morph: update `a` in place to match `b`, keyed by id.
// Keeps focus, caret, scroll, open popovers and anything the user has typed, ticked or selected.

const same = (a: Node, b: Node) =>
  a.nodeType === b.nodeType && a.nodeName === b.nodeName && ((a as Element).id || "") === ((b as Element).id || "");

/** Elements whose content or attributes changed during the last morph (used for the update highlight). */
export const changed = new Set<Element>();
const mark = (n: Node | null) => { const e = n && (n.nodeType === 1 ? n as Element : n.parentElement); if (e) changed.add(e); };

export function morph(a: Node, b: Node) {
  if (!same(a, b)) { a.parentNode?.replaceChild(b, a); mark(b); return; }
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) { a.nodeValue = b.nodeValue; mark(a); } return; }
  const ea = a as any, eb = b as any;
  if (ea.hasAttribute("p-keep")) return;
  // What the server last rendered for a form control. Its live value may differ because the user changed it.
  const dv = ea.defaultValue, dc = ea.defaultChecked, ds = ea.defaultSelected;

  for (const { name } of [...ea.attributes]) {
    if (!eb.hasAttribute(name) && !(name === "open" && ea.tagName === "DETAILS")) ea.removeAttribute(name);
  }
  for (const { name, value } of [...eb.attributes]) if (ea.getAttribute(name) !== value) { ea.setAttribute(name, value); if (name !== "p-updated") mark(ea); }

  // Take the server's value only when the server changed it, and never under the caret.
  if (ea !== document.activeElement) {
    if (eb.defaultValue !== dv) ea.value = ea.defaultValue = eb.defaultValue;
    if (eb.defaultChecked !== dc) ea.checked = eb.defaultChecked;
    if (eb.defaultSelected !== ds) ea.selected = eb.defaultSelected;
  }
  children(ea, eb);
}

function children(a: Element, b: Element) {
  if (a instanceof HTMLTextAreaElement) return;
  const byId = new Map<string, Element>();
  for (const c of a.children) if (c.id) byId.set(c.id, c);
  let cur: ChildNode | null = a.firstChild;
  for (const nb of [...b.childNodes]) {
    const id = (nb as Element).id;
    const hit = id ? byId.get(id) : undefined;
    if (hit) {
      if (hit !== cur) a.insertBefore(hit, cur);
      cur = hit.nextSibling;
      morph(hit, nb);
    } else if (cur && !(cur as Element).id && same(cur, nb)) {
      const next: ChildNode | null = cur.nextSibling;
      morph(cur, nb);
      cur = next;
    } else {
      a.insertBefore(nb, cur);
      mark(nb);
    }
  }
  while (cur) { const n: ChildNode | null = cur.nextSibling; cur.remove(); cur = n; }
}
