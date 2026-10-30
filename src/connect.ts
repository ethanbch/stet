import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const TEMPLATES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates");
const HOOK_MARK = "hook session-start";

export function claudeDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

/** Absolute command that runs this installation of Stet, independent of PATH. */
export function selfCommand(): { node: string; cli: string } {
  const cli = fs.realpathSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "cli.js"));
  return { node: process.execPath, cli };
}

function hasClaude(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function mcpAddArgs(vault: string): string[] {
  const { node, cli } = selfCommand();
  return ["mcp", "add", "--scope", "user", "-e", `STET_HOME=${vault}`, "stet", "--", node, cli, "mcp"];
}

/** Registers the MCP server for every Claude Code project of this user. Returns false if `claude` is missing. */
export function registerMcp(vault: string): boolean {
  if (!hasClaude()) return false;
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", "stet"], { stdio: "ignore" });
  } catch {
    // not registered yet
  }
  execFileSync("claude", mcpAddArgs(vault), { stdio: "ignore" });
  return true;
}

export function unregisterMcp(): boolean {
  if (!hasClaude()) return false;
  try {
    execFileSync("claude", ["mcp", "remove", "--scope", "user", "stet"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

type Settings = { hooks?: Record<string, { matcher?: string; hooks: { type: string; command: string }[] }[]> } & Record<string, unknown>;

function settingsPath(): string {
  return path.join(claudeDir(), "settings.json");
}

function readSettings(): Settings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
  } catch (e) {
    if (fs.existsSync(settingsPath())) throw new Error(`cannot parse ${settingsPath()}: ${(e as Error).message}`);
    return {};
  }
}

function writeSettings(s: Settings): void {
  fs.mkdirSync(claudeDir(), { recursive: true });
  if (fs.existsSync(settingsPath())) fs.copyFileSync(settingsPath(), settingsPath() + ".stet-backup");
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2) + "\n");
}

function withoutStetHook(s: Settings): Settings {
  const groups = s.hooks?.SessionStart;
  if (!groups) return s;
  const kept = groups
    .map((g) => ({ ...g, hooks: g.hooks.filter((h) => !h.command.includes(HOOK_MARK)) }))
    .filter((g) => g.hooks.length);
  const hooks = { ...s.hooks };
  if (kept.length) hooks.SessionStart = kept;
  else delete hooks.SessionStart;
  return { ...s, hooks };
}

/** The Claude Code adapter: a skill and a SessionStart hook. Comfort only; the MCP server works without it. */
export function installAdapter(): string[] {
  const done: string[] = [];
  const skillDir = path.join(claudeDir(), "skills", "stet");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATES, "claude", "SKILL.md"), path.join(skillDir, "SKILL.md"));
  done.push(`skill ${path.join(skillDir, "SKILL.md")}`);

  const { node, cli } = selfCommand();
  const s = withoutStetHook(readSettings());
  const hooks = { ...(s.hooks ?? {}) };
  hooks.SessionStart = [
    ...(hooks.SessionStart ?? []),
    { hooks: [{ type: "command", command: `${JSON.stringify(node)} ${JSON.stringify(cli)} ${HOOK_MARK}` }] },
  ];
  writeSettings({ ...s, hooks });
  done.push(`SessionStart hook in ${settingsPath()}`);
  return done;
}

export function removeAdapter(): string[] {
  const done: string[] = [];
  const skillDir = path.join(claudeDir(), "skills", "stet");
  if (fs.existsSync(skillDir)) {
    fs.rmSync(skillDir, { recursive: true });
    done.push("skill removed");
  }
  const s = readSettings();
  const cleaned = withoutStetHook(s);
  if (JSON.stringify(cleaned) !== JSON.stringify(s)) {
    writeSettings(cleaned);
    done.push("SessionStart hook removed");
  }
  return done;
}
