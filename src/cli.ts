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
    const fiches = vault.fiches();
    const issues = lint(vault);
    const inbox = vault.inbox();
    console.log(`Wiki       ${vault.root}`);
    console.log(`Fiches     ${fiches.length} (${fiches.filter((f) => f.fm.status === "draft").length} to review)`);
    console.log(`Inbox      ${inbox.filter((i) => i.supported).length} waiting, ${inbox.filter((i) => !i.supported).length} unsupported`);
    console.log(`Lint       ${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warning").length} warnings`);
    console.log(`Reuses     ${vault.reuse().total}`);
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

program.parseAsync();
