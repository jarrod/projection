// UI test for an MCP server with mcp-projection. Runs on the BUILT server, no browser needed.
//   node test/ui.test.mjs        (after building)
// Fill in the CONFIG block. Keep the checks; add more for each action the UI offers.
import { testUi } from "mcp-projection/testing";
import { createServer } from "../dist/server.js"; // TODO: path to the built factory

const CONFIG = {
  // An agent call that changes data, and text that should then appear in the UI.
  agentWrite: { name: "add_item", arguments: { title: "Written by the agent" } }, // TODO
  agentWriteShows: "Written by the agent",                                         // TODO
  // A human action: a tool the UI calls, its args (as the UI would send them), and text expected afterwards.
  click: { tool: "complete_item", args: { id: 1 } },                               // TODO
  clickShows: "Done",                                                              // TODO
};

let failures = 0;
const check = (cond, msg) => { console.log(cond ? "PASS" : "FAIL", msg); if (!cond) failures++; };
const warnings = [];
const origWarn = console.warn;
console.warn = (...a) => { const m = a.join(" "); if (m.includes("[mcp-projection]")) warnings.push(m); origWarn(...a); };

const t = await testUi(createServer);
try {
  const hidden = t.modelTools.filter((x) => /^(p_|ui_)/.test(x.name)).map((x) => x.name);
  check(hidden.length === 0, `UI helper tools are hidden from the model ${hidden.join(", ")}`);
  check(!!t.resourceUri, `an attachTo tool points at the UI resource (${t.resourceUri})`);

  const view = await t.mount();
  check(view.html().includes("<p-f"), "the UI mounts");

  await t.agent.callTool(CONFIG.agentWrite);
  await view.until((text) => text.includes(CONFIG.agentWriteShows));
  check(true, "an agent write shows up live");

  check(view.html().includes(`hx-tool="${CONFIG.click.tool}"`), `the page has a control for ${CONFIG.click.tool}`);
  await view.click(CONFIG.click.tool, CONFIG.click.args);
  await view.until((text) => text.includes(CONFIG.clickShows));
  check(true, "a human action works and updates the UI");

  check(warnings.length === 0, `no mcp-projection warnings ${warnings.join(" | ")}`);
  view.close();
} catch (e) {
  failures++;
  console.log("FAIL", e.message);
} finally {
  await t.close();
}
console.log(failures ? `\n${failures} failed` : "\nall UI checks passed");
process.exit(failures ? 1 : 0); // a pending long-poll would otherwise keep Node alive for up to 25 s
