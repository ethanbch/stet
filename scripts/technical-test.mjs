// Technical test of the V1 with a real Claude Code agent (`claude -p`), with and without the adapter.
// Each mode gets a fresh wiki and a temporary project folder; your own Claude Code config is not modified.
// Run after `npm run build`: node scripts/technical-test.mjs [with|without|both]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "..", "dist", "cli.js");
const TEMPLATES = path.resolve(here, "..", "templates");
const { Vault } = await import("../dist/vault.js");
const { lint } = await import("../dist/lint.js");

const STEPS = [
  {
    name: "capture",
    prompt:
      "We just decided to use PostgreSQL instead of SQLite for the billing service, because billing needs concurrent writes from several workers. Keep this in Stet.",
    check: (v) => {
      const notes = fs.readdirSync(v.abs("sources/sessions"));
      const f = v.fiches().find((x) => /postgres/i.test(x.fm.title + x.body));
      return {
        ok: notes.length >= 1 && !!f && f.fm.sources.some((s) => s.startsWith("sources/sessions/")),
        detail: `${notes.length} session note(s); fiche: ${f ? `"${f.fm.title}" citing ${f.fm.sources.join(", ")}` : "none"}`,
      };
    },
  },
  {
    name: "inbox",
    before: (v) =>
      fs.writeFileSync(
        v.abs("inbox/standup-2026-10-29.md"),
        "# Standup, 29 October\n\n- The billing release moves to Friday 6 November: QA needs two more days.\n- Ines owns the migration runbook.\n",
      ),
    prompt: "Process the Stet inbox.",
    check: (v) => {
      const left = v.inbox().length;
      const f = v.fiches().find((x) => x.fm.sources.some((s) => s.startsWith("sources/imports/")));
      return {
        ok: left === 0 && !!f,
        detail: `${left} item(s) left in the inbox; fiche from the import: ${f ? `"${f.fm.title}"` : "none"}`,
      };
    },
  },
  {
    name: "reuse",
    prompt: "Which database did we choose for the billing service, and why? Answer in two sentences.",
    check: (v, out) => {
      const r = v.reuse().total;
      return { ok: r >= 1 && /concurren|same time|at once|simultaneous/i.test(out), detail: `${r} reuse(s) recorded; answer: ${out.trim().slice(0, 200)}` };
    },
  },
];

function runMode(mode) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `stet-tt-${mode}-`));
  const wiki = path.join(base, "wiki");
  const project = path.join(base, "project");
  fs.mkdirSync(project);
  execFileSync(process.execPath, [CLI, "init", wiki], { env: { ...process.env, STET_HOME: wiki } });
  const vault = new Vault(wiki);

  const mcp = path.join(base, "mcp.json");
  fs.writeFileSync(
    mcp,
    JSON.stringify({ mcpServers: { stet: { command: process.execPath, args: [CLI, "mcp"], env: { STET_HOME: wiki } } } }),
  );
  if (mode === "with") {
    // The adapter, installed at project level so the test leaves ~/.claude untouched.
    fs.mkdirSync(path.join(project, ".claude", "skills", "stet"), { recursive: true });
    fs.copyFileSync(path.join(TEMPLATES, "claude", "SKILL.md"), path.join(project, ".claude", "skills", "stet", "SKILL.md"));
    const hook = `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} hook session-start`;
    fs.writeFileSync(
      path.join(project, ".claude", "settings.json"),
      JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: hook }] }] } }),
    );
  }

  const results = [];
  for (const step of STEPS) {
    step.before?.(vault);
    const t = performance.now();
    let out = "";
    try {
      const raw = execFileSync(
        "claude",
        ["-p", step.prompt, "--mcp-config", mcp, "--strict-mcp-config", "--allowedTools", "mcp__stet", "--output-format", "json"],
        { cwd: project, env: { ...process.env, STET_HOME: wiki }, encoding: "utf8", timeout: 300_000 },
      );
      out = JSON.parse(raw).result ?? "";
    } catch (e) {
      out = `claude failed: ${e.message}`;
    }
    const seconds = (performance.now() - t) / 1000;
    vault.refresh();
    const { ok, detail } = step.check(vault, out);
    results.push({ mode, step: step.name, ok, seconds: +seconds.toFixed(1), detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${mode.padEnd(7)} ${step.name.padEnd(8)} ${seconds.toFixed(1)} s  ${detail}`);
  }
  const issues = lint(vault).filter((i) => i.severity === "error");
  console.log(`      ${mode.padEnd(7)} lint     ${issues.length} error(s)${issues.length ? ": " + issues.map((i) => i.message).join("; ") : ""}`);
  console.log(`      wiki kept at ${wiki}`);
  return results;
}

const which = process.argv[2] ?? "both";
const modes = which === "both" ? ["with", "without"] : [which];
const all = modes.flatMap(runMode);
fs.writeFileSync(path.resolve(here, "..", "technical-test-results.json"), JSON.stringify(all, null, 2) + "\n");
process.exitCode = all.every((r) => r.ok) ? 0 : 1;
