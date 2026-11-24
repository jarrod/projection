// Render the UI with realistic data to static HTML for screenshots. No runtime, no server.
//   node preview.mjs [fragment]      (run from the folder you put it in, after building)
// Writes preview-light.html, preview-dark.html and preview-narrow.html (the light page framed at 420 px).
// Delete the outputs when you're done.
import { writeFileSync } from "node:fs";
import { ui } from "./dist/ui.js";       // TODO: path to the built ui module
import { store } from "./dist/store.js"; // TODO: the store the loaders read

// TODO: seed data through the project's own store. Include an empty-ish case, a long title and every status.
function seed() {
  // store.add("Ship the UI layer", "agent");
  // store.add("A deliberately long title that has to wrap somewhere sensible in a narrow host", "you");
}

seed();
const fragment = process.argv[2] ?? "app";
for (const theme of ["light", "dark"]) writeFileSync(`preview-${theme}.html`, await ui.preview(fragment, { theme }));
writeFileSync("preview-narrow.html", '<!doctype html><body style="margin:0"><iframe src="preview-light.html" style="width:420px;height:1000px;border:0"></iframe></body>');

console.log(`Wrote preview-light.html, preview-dark.html, preview-narrow.html for "${fragment}". Screenshot, for example:
  CHROME="\${CHROME:-google-chrome}"   # macOS: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CHROME" --headless=new --screenshot=preview-light.png  --window-size=1040,900  "file://$PWD/preview-light.html"
  "$CHROME" --headless=new --screenshot=preview-dark.png   --window-size=1040,900  "file://$PWD/preview-dark.html"
  "$CHROME" --headless=new --screenshot=preview-narrow.png --window-size=520,1000  "file://$PWD/preview-narrow.html"`);
process.exit(0);
