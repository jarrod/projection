// The example's own theme: how a server brands the shipped components without touching the library.
// Plain (unlayered) CSS, so it beats the default tokens and any shipped theme whatever the selector.
// 1. Set tokens. Use light-dark(light, dark) so the ThemeToggle and the OS mode keep working.
// 2. Restyle a component only where tokens can't say it.
export const paper = `
:root {
  --p-bg: light-dark(#fbf8f1, #1a1814);
  --p-bg-2: light-dark(#f4efe3, #211e19);
  --p-bg-3: light-dark(#ebe4d3, #2c2822);
  --p-fg: light-dark(#2b2620, #eee8dc);
  --p-fg-2: light-dark(#6b6257, #b3aa9b);
  --p-line: light-dark(#e4dccb, #35302a);
  --p-line-2: light-dark(#d3c8b2, #463f36);
  --p-inv: light-dark(#1f6f4a, #4fbf86);
  --p-inv-fg: light-dark(#fff, #10251a);
  --p-ring: light-dark(#1f6f4a, #4fbf86);
  --p-info: light-dark(#1f6f4a, #4fbf86);
  --p-r: 4px;
  --p-r-sm: 3px;
  --p-font: Charter, "Iowan Old Style", Georgia, serif;
}
.hdr h1 { font-size: 26px; font-weight: 700; letter-spacing: 0; }
.hdr { border-bottom: 2px solid var(--p-fg); }
`;
