// Tiny DOM morph: update `a` in place to match `b`, keyed by id.
// Keeps focus, caret, scroll, open popovers and anything the user has typed, ticked or selected.

const same = (a: Node, b: Node) =>
  a.nodeName === b.nodeName && (a as Element).id === (b as Element).id; // nodeName also tells node types apart ("#text", "DIV")

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
    // `open` belongs to the user (a details they opened); aria-busy and p-error to the runtime: an update landing mid-call must not clear them.
    if (!eb.hasAttribute(name) && name !== "open" && name !== "aria-busy" && name !== "p-error") ea.removeAttribute(name);
  }
  // Text under the caret is left alone, attribute included, so the server's new value is still seen as a change once focus moves on.
  const typing = ea === document.activeElement;
  for (const { name, value } of eb.attributes) if (ea.getAttribute(name) !== value && !(typing && name === "value")) { ea.setAttribute(name, value); if (name !== "p-updated") mark(ea); }

  // Take the server's value only when the server changed it.
  if (eb.defaultValue !== dv && !typing) ea.value = ea.defaultValue = eb.defaultValue;
  if (eb.defaultChecked !== dc) ea.checked = eb.defaultChecked;
  if (eb.defaultSelected !== ds) ea.selected = eb.defaultSelected;
  children(ea, eb);
}

function children(a: Element, b: Element) {
  if (a instanceof HTMLTextAreaElement) return;
  const byId = new Map<string, Element>(), ids = new Set<string>();
  for (const c of a.children) if (c.id) byId.set(c.id, c);
  for (const c of b.children) ids.add(c.id);
  const gone = (n: ChildNode | null): n is Element => !!(n as Element | null)?.id && !ids.has((n as Element).id);
  let cur: ChildNode | null = a.firstChild;
  for (const nb of [...b.childNodes]) {
    const id = (nb as Element).id;
    const hit = id ? byId.get(id) : undefined;
    if (hit) {
      // Drop removed rows first: moving `hit` up past them would cost it focus and close its popover.
      while (cur !== hit && gone(cur)) { const n: ChildNode | null = cur.nextSibling; cur.remove(); cur = n; }
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
