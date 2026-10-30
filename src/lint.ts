import { looseKey, titleKey } from "./fiche.js";
import type { Vault } from "./vault.js";

export type Severity = "error" | "warning" | "info";

export interface Issue {
  code:
    | "invalid_fiche"
    | "broken_link"
    | "missing_source"
    | "orphan"
    | "duplicate"
    | "index_out_of_sync"
    | "stale_inbox"
    | "unsupported_inbox"
    | "stale_draft";
  severity: Severity;
  message: string;
  /** Fiche title, or a vault path for files that are not valid fiches. */
  target?: string;
}

const DAY = 86_400_000;
const ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

function similar(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 8 || Math.abs(a.length - b.length) > 2) return false;
  // Levenshtein distance up to 2, for near-identical titles.
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length] <= 2;
}

/** Mechanical checks only. Contradictions and outdated facts are the agent's job. */
export function lint(vault: Vault, now = Date.now()): Issue[] {
  const issues: Issue[] = [];
  vault.refresh();
  const fiches = vault.fiches();

  for (const bad of vault.invalidFiles())
    issues.push({
      code: "invalid_fiche",
      severity: "error",
      message: `${bad.path}: ${bad.problems.map((p) => `${p.field}: ${p.message}`).join("; ")}`,
      target: bad.path,
    });

  const inbound = new Map<string, number>();
  for (const f of fiches) {
    for (const l of vault.linksOf(f)) {
      const to = vault.resolve(l.target);
      if (!to) {
        issues.push({ code: "broken_link", severity: "error", message: `[[${l.target}]] points to no fiche`, target: f.fm.title });
      } else if (to.path !== f.path) {
        inbound.set(to.path, (inbound.get(to.path) ?? 0) + 1);
      }
    }
    for (const s of f.fm.sources) {
      const err = vault.checkSource(s);
      if (err) issues.push({ code: "missing_source", severity: "error", message: err, target: f.fm.title });
    }
    if (f.fm.status === "draft") {
      const age = (now - Date.parse(f.fm.updated)) / DAY;
      if (age > vault.config.draftStaleDays)
        issues.push({
          code: "stale_draft",
          severity: "info",
          message: `draft for ${Math.floor(age)} days; validate or reject it`,
          target: f.fm.title,
        });
    }
  }

  if (fiches.length > 1)
    for (const f of fiches)
      if (!inbound.get(f.path))
        issues.push({ code: "orphan", severity: "warning", message: "no other fiche links here", target: f.fm.title });

  const seen: { key: string; title: string }[] = [];
  for (const f of fiches) {
    const key = looseKey(f.fm.title);
    const twin = seen.find((s) => similar(s.key, key) && titleKey(s.title) !== titleKey(f.fm.title));
    if (twin)
      issues.push({
        code: "duplicate",
        severity: "warning",
        message: `title close to "${twin.title}"; merge them if they cover the same thing`,
        target: f.fm.title,
      });
    seen.push({ key, title: f.fm.title });
  }

  if (!vault.indexInSync())
    issues.push({ code: "index_out_of_sync", severity: "warning", message: "index.md does not match the fiches; run `stet lint --fix`" });

  for (const item of vault.inbox()) {
    if (!item.supported) {
      issues.push({
        code: "unsupported_inbox",
        severity: "warning",
        message: `${item.name}: format not supported; convert it to text or markdown`,
        target: item.path,
      });
      continue;
    }
    const age = (now - item.mtimeMs) / DAY;
    if (age > vault.config.inboxStaleDays)
      issues.push({
        code: "stale_inbox",
        severity: "warning",
        message: `${item.name} waiting for ${Math.floor(age)} days`,
        target: item.path,
      });
  }

  return issues.sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.code.localeCompare(b.code));
}

/** Repairs what can be repaired without judgment. Today: the index. */
export function fix(vault: Vault): string[] {
  const done: string[] = [];
  if (!vault.indexInSync()) {
    vault.writeIndex();
    done.push("index.md rebuilt");
  }
  return done;
}
