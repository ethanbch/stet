import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAdapter, removeAdapter } from "../src/connect.js";

const CLI = path.resolve(__dirname, "../dist/cli.js");
let dir: string;
const prev = process.env.CLAUDE_CONFIG_DIR;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "stet-claude-"));
  process.env.CLAUDE_CONFIG_DIR = dir;
});

afterEach(() => {
  if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prev;
});

describe("Claude Code adapter", () => {
  it("adds the skill and the hook without touching other settings, idempotently, and removes them", () => {
    const settings = path.join(dir, "settings.json");
    const other = { matcher: "startup", hooks: [{ type: "command", command: "echo hi" }] };
    fs.writeFileSync(settings, JSON.stringify({ model: "opus", hooks: { SessionStart: [other] } }));

    installAdapter();
    installAdapter();
    const s = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(s.model).toBe("opus");
    expect(s.hooks.SessionStart).toHaveLength(2);
    expect(s.hooks.SessionStart[0]).toEqual(other);
    expect(s.hooks.SessionStart[1].hooks[0].command).toContain("hook session-start");
    expect(fs.existsSync(path.join(dir, "skills", "stet", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(settings + ".stet-backup")).toBe(true);

    removeAdapter();
    const after = JSON.parse(fs.readFileSync(settings, "utf8"));
    expect(after.hooks.SessionStart).toEqual([other]);
    expect(fs.existsSync(path.join(dir, "skills", "stet"))).toBe(false);
  });

  it("refuses to overwrite a settings file it cannot parse", () => {
    fs.writeFileSync(path.join(dir, "settings.json"), "{ not json");
    expect(() => installAdapter()).toThrow(/cannot parse/);
    expect(fs.readFileSync(path.join(dir, "settings.json"), "utf8")).toBe("{ not json");
  });
});

describe("session-start hook", () => {
  it("summarises the wiki, and says capture is off in an excluded folder", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "stet-hook-"));
    execFileSync(process.execPath, [CLI, "init"], { env: { ...process.env, STET_HOME: home } });
    fs.writeFileSync(path.join(home, "inbox", "a.md"), "x");
    const run = (cwd: string) =>
      execFileSync(process.execPath, [CLI, "hook", "session-start"], {
        env: { ...process.env, STET_HOME: home },
        input: JSON.stringify({ cwd }),
        encoding: "utf8",
      });
    expect(run("/tmp/project")).toContain("1 inbox items to process");
    fs.writeFileSync(path.join(home, ".stet", "config.toml"), 'excluded = ["/work/client"]\n');
    expect(run("/work/client/app")).toContain("capture is disabled");
  });
});

describe("MCP registration", () => {
  it("puts the server name before the variadic -e option", async () => {
    const { mcpAddArgs } = await import("../src/connect.js");
    const args = mcpAddArgs("/x/Stet");
    expect(args.indexOf("stet")).toBeLessThan(args.indexOf("-e"));
    expect(args.slice(args.indexOf("--") + 1).at(-1)).toBe("mcp");
  });
});
