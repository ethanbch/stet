import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

export const LAYOUT = {
  inbox: "inbox",
  sources: "sources",
  imports: "sources/imports",
  sessions: "sources/sessions",
  fiches: "fiches",
  index: "index.md",
  log: "log.md",
  agents: "AGENTS.md",
  state: ".stet",
  config: ".stet/config.toml",
  rejected: ".stet/rejected",
  usage: ".stet/usage.jsonl",
  imported: ".stet/imports.json",
} as const;

export interface StetConfig {
  port: number;
  excluded: string[];
  inboxStaleDays: number;
  draftStaleDays: number;
  idleMinutes: number;
}

export const DEFAULT_CONFIG: StetConfig = {
  port: 4747,
  excluded: [],
  inboxStaleDays: 7,
  draftStaleDays: 14,
  idleMinutes: 10,
};

export const DEFAULT_CONFIG_TOML = `# Stet configuration

# Port of the local web interface (127.0.0.1 only).
port = 4747

# Folders where the agent never proposes a capture and where writes are refused.
# Example: excluded = ["~/Work/client-repos"]
excluded = []

# Lint thresholds, in days.
inbox_stale_days = 7
draft_stale_days = 14

# On-demand mode: the web server stops after this many idle minutes.
idle_minutes = 10
`;

function pointerFile(): string {
  return path.join(os.homedir(), ".config", "stet", "vault");
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** Vault location: STET_HOME, then the pointer written by `stet init <path>`, then ~/Stet. */
export function vaultRoot(): string {
  if (process.env.STET_HOME) return path.resolve(expandHome(process.env.STET_HOME));
  try {
    const p = fs.readFileSync(pointerFile(), "utf8").trim();
    if (p) return path.resolve(expandHome(p));
  } catch {
    // no pointer: default location
  }
  return path.join(os.homedir(), "Stet");
}

export function writeVaultPointer(root: string): void {
  fs.mkdirSync(path.dirname(pointerFile()), { recursive: true });
  fs.writeFileSync(pointerFile(), root + "\n");
}

export function loadConfig(root: string): StetConfig {
  const file = path.join(root, LAYOUT.config);
  let raw: Record<string, unknown> = {};
  try {
    raw = parseToml(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    port: num(raw.port, DEFAULT_CONFIG.port),
    excluded: Array.isArray(raw.excluded) ? raw.excluded.filter((x): x is string => typeof x === "string") : [],
    inboxStaleDays: num(raw.inbox_stale_days, DEFAULT_CONFIG.inboxStaleDays),
    draftStaleDays: num(raw.draft_stale_days, DEFAULT_CONFIG.draftStaleDays),
    idleMinutes: num(raw.idle_minutes, DEFAULT_CONFIG.idleMinutes),
  };
}

/** True when `dir` is one of the excluded folders or inside one. */
export function isExcluded(dir: string, config: StetConfig): boolean {
  const target = path.resolve(dir);
  return config.excluded.some((ex) => {
    const base = path.resolve(expandHome(ex));
    return target === base || target.startsWith(base + path.sep);
  });
}
