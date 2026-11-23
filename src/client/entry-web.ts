import { start } from "./runtime.js";
import { httpTransport } from "./http.js";
const st = JSON.parse(document.getElementById("p-state")!.textContent!);
start(httpTransport(st.base), st);
