// Compare static/listparser.js with listparser.py over the cached listhammer lists.
// Usage: dump python results as a JSON array, then: node tools/test_parser_parity.mjs <recentLists.json> <py.json>
import { readFileSync } from "node:fs";
import vm from "node:vm";
const root = new URL("..", import.meta.url).pathname;
const ctx = { window: {}, console }; vm.createContext(ctx);
vm.runInContext(readFileSync(root + "static/listparser.js", "utf8"), ctx);
const load = async p => JSON.parse(readFileSync(root + "static/data/rules/" + p, "utf8"));
const lists = JSON.parse(readFileSync(process.argv[2], "utf8"));
const py = JSON.parse(readFileSync(process.argv[3], "utf8"));
let same = 0, diff = 0;
for (let i = 0; i < lists.length; i++) {
  const js = await ctx.window.parseList(lists[i].listText || "", load);
  const a = JSON.stringify(js), b = JSON.stringify(py[i]);
  if (a === b) same++; else { diff++; if (diff <= 3) { console.log("DIFF", i); for (const k of Object.keys(py[i] || {})) if (JSON.stringify(js[k]) !== JSON.stringify(py[i][k])) console.log(" ", k, "\n   js:", JSON.stringify(js[k]).slice(0, 300), "\n   py:", JSON.stringify(py[i][k]).slice(0, 300)); } }
}
console.log({ same, diff });
