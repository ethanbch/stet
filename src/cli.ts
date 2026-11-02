#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { expandHome, vaultRoot, writeVaultPointer } from "./config.js";
import { fix, lint } from "./lint.js";
import { Vault } from "./vault.js";

const program = new Command();
program.name("stet").description("A thin layer that lets a coding agent build and maintain a markdown wiki for you.").version("0.1.0");

function openVault(): Vault {
  const vault = new Vault(vaultRoot());
  if (!vault.isInitialized()) {
    console.error(`No wiki at ${vault.root}. Run \`stet init\` first.`);
    process.exit(1);
  }
  return vault;
}

program
  .command("init")
  .description("Create the wiki folder (default ~/Stet) and its AGENTS.md")
  .argument("[path]", "where to create the wiki")
  .action((p?: string) => {
    const root = p ? path.resolve(expandHome(p)) : vaultRoot();
    if (p) writeVaultPointer(root);
    const vault = new Vault(root);
    const created = vault.init();
    console.log(created.length ? `Wiki ready at ${root}\nCreated: ${created.join(", ")}` : `Wiki already set up at ${root}`);
    console.log("Next: `stet connect` to register Stet with Claude Code.");
  });

program
  .command("status")
  .description("Inbox, drafts and lint summary")
  .action(() => {
    const vault = openVault();
    const cards = vault.cards();
    const issues = lint(vault);
    const inbox = vault.inbox();
    console.log(`Wiki       ${vault.root}`);
    console.log(`Cards      ${cards.length} (${cards.filter((f) => f.fm.status === "draft").length} to review)`);
    console.log(`Inbox      ${inbox.filter((i) => i.supported).length} waiting, ${inbox.filter((i) => !i.supported).length} unsupported`);
    console.log(`Lint       ${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warning").length} warnings`);
    console.log(`Recalled   ${vault.reuse().total}`);
  });

program
  .command("lint")
  .description("Check links, sources, orphans, duplicates and the index")
  .option("--fix", "repair what needs no judgment (the index)")
  .option("--json", "machine-readable output")
  .action((opts: { fix?: boolean; json?: boolean }) => {
    const vault = openVault();
    const fixed = opts.fix ? fix(vault) : [];
    const issues = lint(vault);
    if (opts.json) {
      console.log(JSON.stringify({ fixed, issues }, null, 2));
    } else {
      for (const f of fixed) console.log(`fixed    ${f}`);
      for (const i of issues) console.log(`${i.severity.padEnd(8)} ${i.code.padEnd(18)} ${i.target ? `${i.target}: ` : ""}${i.message}`);
      if (!issues.length) console.log("No problems.");
    }
    process.exitCode = issues.some((i) => i.severity === "error") ? 1 : 0;
  });

program
  .command("mcp")
  .description("Run the MCP server on stdio (Claude Code starts this for you)")
  .action(async () => {
    const { runMcp } = await import("./mcp.js");
    await runMcp(openVault());
  });

program
  .command("serve")
  .description("Run the web interface in the foreground")
  .option("--port <port>", "port", (v) => Number(v))
  .option("--idle <minutes>", "stop after this many idle minutes", (v) => Number(v))
  .option("--launchd", "started by launchd: use the inherited socket, stay silent, stop when idle")
  .action(async (opts: { port?: number; idle?: number; launchd?: boolean }) => {
    const { serve } = await import("./web.js");
    const vault = openVault();
    const port = opts.port ?? vault.config.port;
    if (opts.launchd) await serve(vault, { port, fd: 0, idleMinutes: vault.config.idleMinutes, quiet: true });
    else await serve(vault, { port, idleMinutes: opts.idle });
  });

async function reachable(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/home`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

program
  .command("open")
  .description("Open the interface in your browser, starting the server if needed")
  .action(async () => {
    const vault = openVault();
    const port = vault.config.port;
    const url = `http://127.0.0.1:${port}`;
    if (!(await reachable(port))) {
      const { spawn } = await import("node:child_process");
      const child = spawn(process.execPath, [process.argv[1], "serve", "--idle", String(vault.config.idleMinutes)], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, STET_HOME: vault.root },
      });
      child.unref();
      for (let i = 0; i < 30 && !(await reachable(port)); i++) await new Promise((r) => setTimeout(r, 100));
    }
    if (!(await reachable(port))) {
      console.error(`Could not start the interface on port ${port}. Try \`stet serve\` to see the error.`);
      process.exit(1);
    }
    if (process.platform === "darwin") {
      const { execFile } = await import("node:child_process");
      execFile("open", [url]);
    }
    console.log(url);
  });

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [Y/n] `)).trim().toLowerCase();
  rl.close();
  return a === "" || a === "y" || a === "yes" || a === "o" || a === "oui";
}

program
  .command("connect")
  .description("Register Stet with Claude Code, install the adapter, optionally start the interface on demand")
  .option("--no-adapter", "MCP server only, without the skill and the SessionStart hook")
  .option("--launchd", "start the interface on demand without asking")
  .option("--no-launchd", "do not set up the on-demand start")
  .action(async (opts: { adapter: boolean; launchd?: boolean }) => {
    const connect = await import("./connect.js");
    // Claude Code and launchd start Stet by path. A copy run through npx lives in npm's cache, which npm may clear.
    if (connect.runFromNpxCache()) {
      console.error("Stet must stay installed for Claude Code to start it. Install it, then connect:\n\n  npm install -g stet && stet connect\n");
      process.exit(1);
    }
    const vault = new Vault(vaultRoot());
    if (!vault.isInitialized()) {
      vault.init();
      console.log(`Created the wiki at ${vault.root}`);
    }
    if (connect.registerMcp(vault.root)) console.log("Registered the stet MCP server in Claude Code (user scope).");
    else {
      console.log("The `claude` command was not found. Register the server by hand:");
      console.log(`  claude ${connect.mcpAddArgs(vault.root).map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}`);
    }
    if (opts.adapter) for (const d of connect.installAdapter()) console.log(`Installed ${d}`);
    const argv = process.argv.slice(2);
    const wantLaunchd = argv.includes("--launchd")
      ? true
      : argv.includes("--no-launchd")
        ? false
        : process.platform === "darwin" && (await ask("Start the interface on demand when you open it from the Dock?"));
    if (wantLaunchd) {
      const launchd = await import("./launchd.js");
      launchd.install({ ...connect.selfCommand(), port: vault.config.port, vault: vault.root });
      console.log(`On-demand start installed: http://127.0.0.1:${vault.config.port} starts Stet when opened.`);
    }
    console.log("");
    console.log("Done. Restart Claude Code sessions to load Stet.");
    console.log("Open the interface with `stet open`, then add it to the Dock: Safari > File > Add to Dock, or Chrome > Install.");
  });

program
  .command("disconnect")
  .description("Remove Stet from Claude Code and stop the on-demand start; the wiki is kept")
  .option("--adapter-only", "remove only the skill and the hook, keep the MCP server")
  .action(async (opts: { adapterOnly?: boolean }) => {
    const connect = await import("./connect.js");
    for (const d of connect.removeAdapter()) console.log(d);
    if (opts.adapterOnly) return;
    if (connect.unregisterMcp()) console.log("MCP server removed from Claude Code");
    const launchd = await import("./launchd.js");
    if (launchd.uninstall()) console.log("On-demand start removed");
  });

const hook = program.command("hook").description("Hooks called by Claude Code");
hook
  .command("session-start")
  .description("Print a short wiki summary for the agent's context")
  .action(async () => {
    try {
      let cwd = process.cwd();
      if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const c of process.stdin) chunks.push(c as Buffer);
        try {
          cwd = JSON.parse(Buffer.concat(chunks).toString("utf8")).cwd || cwd;
        } catch {
          // no JSON input
        }
      }
      const vault = new Vault(vaultRoot());
      if (!vault.isInitialized()) return;
      const { isExcluded } = await import("./config.js");
      if (isExcluded(cwd, vault.config)) {
        console.log("Stet: capture is disabled in this folder. Do not propose or write anything to the Stet wiki in this session.");
        return;
      }
      const cards = vault.cards();
      const drafts = cards.filter((f) => f.fm.status === "draft").length;
      const waiting = vault.inbox().filter((i) => i.supported).length;
      const lines = [`Stet wiki: ${cards.length} cards, ${drafts} waiting for the user's review, ${waiting} inbox items to process.`];
      lines.push("When this session produces a durable decision, fix or fact, propose once to keep it in Stet (stet skill). Search Stet before answering questions it may cover.");
      if (waiting)
        lines.push(
          `${waiting} file(s) wait in the Stet inbox. The user expects them processed automatically: before their first request, run the stet skill's "Process the inbox" loop (queue_next, write_card, complete_item), then tell them in one line what the files became.`,
        );
      console.log(lines.join("\n"));
    } catch {
      // a hook must never break a session
    }
  });

program.parseAsync();
