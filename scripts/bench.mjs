// Measures Stet on a generated wiki. Run after `npm run build`: node scripts/bench.mjs [fiches]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Vault } from "../dist/vault.js";
import { search } from "../dist/search.js";
import { lint } from "../dist/lint.js";
import { createApp } from "../dist/web.js";

const n = Number(process.argv[2] ?? 1000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "stet-bench-"));
const vault = new Vault(root);
vault.init();
const agent = { session: "s-bench" };
const time = (fn) => {
  const t = performance.now();
  fn();
  return performance.now() - t;
};

const write = time(() => {
  for (let i = 0; i < n; i++)
    vault.writeFiche(
      {
        title: `Topic ${i} note`,
        body: `Body of fiche ${i} about release planning and search.${i ? ` See [[Topic ${i - 1} note]].` : ""}`,
        sources: [`https://example.com/${i}`],
        tags: [`t${i % 20}`],
      },
      agent,
    );
});
const fresh = new Vault(root);
const load = time(() => fresh.fiches());
const find = time(() => search(fresh.fiches(), "release planning"));
const check = time(() => lint(fresh));
const app = createApp(fresh, 4747);
const t = performance.now();
await app.request("/api/home", { headers: { host: "127.0.0.1:4747" } });
const home = performance.now() - t;

const row = (label, ms) => console.log(`${label.padEnd(28)} ${ms.toFixed(1)} ms`);
console.log(`${n} fiches, Node ${process.version}, ${os.cpus()[0].model}`);
row("write_fiche, average", write / n);
row("load all fiches (cold)", load);
row("search", find);
row("lint", check);
row("overview API", home);
fs.rmSync(root, { recursive: true, force: true });
