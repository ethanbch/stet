// Takes the README screenshots from the demo wiki with headless Chrome (macOS, Node 22).
// Run after `npm run build`: node scripts/screenshots.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4791;
const DEBUG = 9333;
const W = 1470;
const H = 802;
const out = path.resolve("docs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stet-shots-"));
const wiki = path.join(tmp, "wiki");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const run = (cmd, args, env = {}) => spawn(cmd, args, { stdio: "ignore", env: { ...process.env, ...env } });
await new Promise((res, rej) => run("node", ["scripts/demo.mjs", wiki]).on("exit", (c) => (c ? rej(new Error("demo failed")) : res())));
const server = run("node", ["dist/cli.js", "serve", "--port", String(PORT)], { STET_HOME: wiki });
const chrome = run(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${DEBUG}`,
  `--user-data-dir=${path.join(tmp, "chrome")}`,
  `--window-size=${W},${H}`,
  "--hide-scrollbars",
  "--force-device-scale-factor=2",
  "about:blank",
]);

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${DEBUG}/json`)).json();
      target = list.find((t) => t.type === "page");
    } catch {
      // Chrome not up yet
    }
  }
  if (!target) throw new Error("Chrome did not start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      pending.set(++id, r);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const js = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true });

  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 2, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(800);
  // The demo is a wiki in use: no setup guide, dark theme.
  await js(`localStorage.setItem("stet-setup-hidden", "1"); localStorage.setItem("stet-installed", "1"); localStorage.setItem("stet-theme", "dark");`);

  const shot = async (name, hash, prepare) => {
    // A hash change alone keeps the page (and any open dialog): load it fresh each time.
    await send("Page.navigate", { url: "about:blank" });
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/${hash}` });
    await sleep(1500);
    if (prepare) await prepare();
    const { result } = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    fs.writeFileSync(path.join(out, name), Buffer.from(result.data, "base64"));
    console.log(`docs/${name}`);
  };

  await shot("today.jpg", "#/");
  await shot("review.jpg", "#/review");
  await shot("graph.jpg", "#/graph", async () => {
    await sleep(3000); // let the layout settle and frame itself
  });
  ws.close();
} finally {
  chrome.kill();
  server.kill();
  await sleep(300);
  fs.rmSync(tmp, { recursive: true, force: true });
}
