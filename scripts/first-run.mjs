// Opens Stet as a new user sees it: an empty wiki, a fresh browser profile, no Claude Code config.
// Your own wiki, settings and browser data are not touched. Run after `npm run build`:
//   node scripts/first-run.mjs        (Ctrl-C to stop and delete the sandbox)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 4790);
const box = fs.mkdtempSync(path.join(os.tmpdir(), "stet-first-run-"));
const env = {
  ...process.env,
  STET_HOME: path.join(box, "Stet"),
  CLAUDE_CONFIG_DIR: path.join(box, "claude"),
};
const cli = path.resolve("dist/cli.js");

// What `stet connect` does first: create the wiki. The rest of connect (Claude Code, launchd) is left
// to you, so the guide shows those steps as not done, the way a new user meets them.
// No path argument: init follows STET_HOME and leaves your default-wiki pointer alone.
spawnSync("node", [cli, "init"], { env, stdio: "ignore" });
const server = spawn("node", [cli, "serve", "--port", String(PORT)], { env, stdio: "inherit" });

const url = `http://127.0.0.1:${PORT}/`;
// A separate Chrome profile: no remembered theme, no hidden guide, no "installed" flag.
const profile = path.join(box, "chrome");
setTimeout(() => {
  if (process.platform === "darwin")
    spawn("open", ["-na", "Google Chrome", "--args", `--user-data-dir=${profile}`, "--no-first-run", "--new-window", url], { stdio: "ignore" });
  console.log(`
First run sandbox: ${box}
  wiki          ${env.STET_HOME} (empty)
  interface     ${url}
To try the agent steps in this sandbox, in another terminal:
  STET_HOME="${env.STET_HOME}" CLAUDE_CONFIG_DIR="${env.CLAUDE_CONFIG_DIR}" claude
Ctrl-C stops the server, closes that window and deletes the sandbox.`);
}, 600);

const stop = () => {
  server.kill();
  // Close the sandbox window too, or Chrome keeps writing into the deleted profile.
  spawnSync("pkill", ["-f", `user-data-dir=${profile}`]);
  fs.rmSync(box, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
