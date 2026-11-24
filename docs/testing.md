# Testing

Three checks, each proving something different: a `testUi` test proves behaviour, a preview proves it looks right, and the tool snapshot proves the model sees nothing new.

## Test behaviour with `testUi`

`testUi` runs your server factory twice, once as an agent client and once as a host client, and mounts the UI. No browser is involved.

```js
import { testUi } from "mcp-projection/testing";
import { createServer } from "./dist/server.js";

const t = await testUi(createServer);
const view = await t.mount();           // or t.mount({ q: "x" }) with starting params
await t.agent.callTool({ name: "add_note", arguments: { title: "Hello" } });
await view.until((text) => text.includes("Hello"));
await view.click("pin_note", { id: 1 });
await view.set({ q: "hello" });         // like a set control
view.close(); await t.close(); process.exit();
```

Cover at least: the UI mounts, an agent write shows up live, a human action works, and `p_sync` is not among `t.modelTools`. Every member of `t` and `view` is in the [reference](reference.md#test-harness).

Two things to know:

- `click` doesn't check that a matching control exists. Assert `view.html().includes('hx-tool="pin_note"')` when it matters.
- Finish with `process.exit()`. A pending long-poll on the server can keep Node alive for up to 25 seconds after `t.close()`.

To snapshot the HTML instead:

```js
const html = await ui.render({ q: "x" }, "u1");   // params, then user; includes the <p-f id="p-root"> wrapper
```

## Look at it

Tests don't prove it looks right. Render a static, styled page and look at it:

```bash
npx mcp-projection preview dist/ui.js > preview.html
npx mcp-projection preview dist/ui.js '{"q":"x"}' --dark > preview-dark.html
```

Arguments: the compiled module (it must export `ui`), optional view params as JSON, `--dark` or `--light`, `--user=<id>`. The page has the CSS and no runtime.

The CLI renders in a fresh process, often with an empty store. To see real content, write a short script that seeds the store and calls `ui.preview()`. [assets/preview.mjs](../skills/mcp-projection/assets/preview.mjs) is a starting point:

```js
import { writeFileSync } from "node:fs";
import { ui } from "./dist/ui.js";
import { store } from "./dist/store.js";
store.add("Ship the UI layer", "agent");
store.add("Write the guide", "jarrod");
for (const theme of ["light", "dark"]) writeFileSync(`preview-${theme}.html`, await ui.preview({}, { theme }));
process.exit(0);
```

Take a screenshot with headless Chrome (on macOS the binary is `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`):

```bash
google-chrome --headless=new --screenshot=preview.png --window-size=1040,900 "file://$PWD/preview-light.html"
```

Check light and dark, a narrow width (about 420 px), empty states and long text. Headless Chrome won't lay out narrower than 500 px: a smaller `--window-size` just crops. For a true narrow layout, load the preview in an iframe of that width:

```bash
echo '<body style="margin:0"><iframe src="preview-light.html" style="width:420px;height:900px;border:0"></iframe>' > narrow.html
```

```bash
google-chrome --headless=new --screenshot=narrow.png --window-size=520,900 "file://$PWD/narrow.html"
```

[Design the UI](design.md#7-review-the-result) has a list of what to look for.

## Prove the agent surface didn't change

`tool-snapshot.mjs` connects to your server as a plain MCP client and records every model-visible tool, and optionally the results of some calls. Take a snapshot before adding the UI and compare after:

```bash
node tool-snapshot.mjs --out before.json -- node dist/index.js
```

```bash
node tool-snapshot.mjs --compare before.json -- node dist/index.js
```

The script is in `skills/mcp-projection/scripts/`, and installed at `node_modules/mcp-projection/skills/mcp-projection/scripts/`. With `--compare`, a changed or missing tool fails with exit code 1. The only new model-visible tool to expect is `web.tool`. All the flags are in the [reference](reference.md#tool-snapshot-script).
