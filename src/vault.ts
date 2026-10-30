import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_TOML, LAYOUT, isExcluded, loadConfig, type StetConfig } from "./config.js";
import {
  FrontmatterSchema,
  ficheFileName,
  isExternalSource,
  looseKey,
  parseFiche,
  serializeFiche,
  summaryOf,
  titleKey,
  today,
  zodProblems,
  type Fiche,
  type Frontmatter,
  type Problem,
  type Status,
} from "./fiche.js";
import { extractLinks, type WikiLink } from "./links.js";

export const SUPPORTED_INBOX = new Set([".md", ".markdown", ".txt", ".text", ".vtt", ".srt"]);

export interface InvalidFile {
  path: string;
  title?: string;
  problems: Problem[];
}

export interface InboxItem {
  name: string;
  path: string;
  size: number;
  mtimeMs: number;
  supported: boolean;
}

export interface LogEntry {
  at: string;
  action: string;
  title?: string;
  detail?: string;
  session?: string;
}

export interface Actor {
  /** Session id of the MCP server process, or "user" for the interface and the CLI. */
  session: string;
  /** Working directory the agent runs in; writes are refused inside excluded folders. */
  cwd?: string;
}

export type WriteResult =
  | { ok: true; path: string; created: boolean; notes: string[] }
  | { ok: false; problems: Problem[] };

export interface FicheInput {
  title: string;
  body: string;
  sources: string[];
  tags: string[];
  summary?: string;
  update?: boolean;
}

interface CacheEntry {
  mtimeMs: number;
  fiche?: Fiche;
  invalid?: InvalidFile;
  links: WikiLink[];
}

const TEMPLATES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates");

export class Vault {
  readonly root: string;
  config: StetConfig;
  private cache = new Map<string, CacheEntry>();

  constructor(root: string) {
    this.root = path.resolve(root);
    this.config = loadConfig(this.root);
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  isInitialized(): boolean {
    return fs.existsSync(this.abs(LAYOUT.fiches)) && fs.existsSync(this.abs(LAYOUT.state));
  }

  /** Creates the folder layout. Existing files are never overwritten. */
  init(): string[] {
    const created: string[] = [];
    for (const dir of [LAYOUT.inbox, LAYOUT.imports, LAYOUT.sessions, LAYOUT.fiches, LAYOUT.rejected]) {
      if (!fs.existsSync(this.abs(dir))) {
        fs.mkdirSync(this.abs(dir), { recursive: true });
        created.push(dir + "/");
      }
    }
    const files: [string, () => string][] = [
      [LAYOUT.config, () => DEFAULT_CONFIG_TOML],
      [LAYOUT.agents, () => fs.readFileSync(path.join(TEMPLATES, "AGENTS.md"), "utf8")],
      [".gitignore", () => ".stet/*\n!.stet/config.toml\n!.stet/usage.jsonl\n!.stet/imports.json\n"],
      [LAYOUT.log, () => "# Log\n\nWritten by Stet. Newest entries at the bottom.\n\n"],
    ];
    for (const [rel, content] of files) {
      if (!fs.existsSync(this.abs(rel))) {
        fs.writeFileSync(this.abs(rel), content());
        created.push(rel);
      }
    }
    this.config = loadConfig(this.root);
    if (!fs.existsSync(this.abs(LAYOUT.index))) {
      this.writeIndex();
      created.push(LAYOUT.index);
    }
    return created;
  }

  // ---------- reading ----------

  private scanFiles(): void {
    const dir = this.abs(LAYOUT.fiches);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("."));
    } catch {
      this.cache.clear();
      return;
    }
    const seen = new Set<string>();
    for (const name of names) {
      const rel = `${LAYOUT.fiches}/${name}`;
      seen.add(rel);
      let st: fs.Stats;
      try {
        st = fs.statSync(path.join(dir, name));
      } catch {
        continue;
      }
      const hit = this.cache.get(rel);
      if (hit && hit.mtimeMs === st.mtimeMs) continue;
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      const parsed = parseFiche(text, rel, st.mtimeMs);
      const body = parsed.fiche?.body ?? text;
      this.cache.set(rel, {
        mtimeMs: st.mtimeMs,
        fiche: parsed.fiche,
        invalid: parsed.fiche ? undefined : { path: rel, title: parsed.title, problems: parsed.problems },
        links: extractLinks(body),
      });
    }
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
  }

  fiches(): Fiche[] {
    this.scanFiles();
    return [...this.cache.values()]
      .flatMap((e) => (e.fiche ? [e.fiche] : []))
      .sort((a, b) => a.fm.title.localeCompare(b.fm.title));
  }

  invalidFiles(): InvalidFile[] {
    this.scanFiles();
    return [...this.cache.values()].flatMap((e) => (e.invalid ? [e.invalid] : []));
  }

  linksOf(f: Fiche): WikiLink[] {
    this.scanFiles();
    return this.cache.get(f.path)?.links ?? extractLinks(f.body);
  }

  /** Finds a fiche by title, then by file name (what Obsidian does). */
  resolve(target: string): Fiche | undefined {
    const key = titleKey(target);
    const all = this.fiches();
    return (
      all.find((f) => titleKey(f.fm.title) === key) ??
      all.find((f) => titleKey(path.basename(f.path, ".md")) === key) ??
      all.find((f) => titleKey(f.path) === key || titleKey(f.path) === key + ".md")
    );
  }

  backlinks(f: Fiche): Fiche[] {
    return this.fiches().filter(
      (o) => o.path !== f.path && this.linksOf(o).some((l) => this.resolve(l.target)?.path === f.path),
    );
  }

  /** A local source: inside the vault, under sources/ or inbox/, and present. */
  checkSource(src: string): string | undefined {
    if (isExternalSource(src)) return undefined;
    const rel = path.posix.normalize(src.replace(/\\/g, "/").replace(/^\.\//, ""));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return `source "${src}" is outside the vault`;
    if (rel.startsWith(LAYOUT.fiches + "/"))
      return `source "${src}" is a fiche; cite raw sources and link fiches with [[...]] in the body`;
    if (!rel.startsWith(LAYOUT.sources + "/") && !rel.startsWith(LAYOUT.inbox + "/"))
      return `source "${src}" must be under sources/ or inbox/, or be a URL`;
    if (rel.startsWith(LAYOUT.inbox + "/")) {
      const name = rel.slice(LAYOUT.inbox.length + 1);
      if (fs.existsSync(this.abs(rel)) || this.importedPath(name)) return undefined;
      return `source "${src}" not found in the inbox`;
    }
    if (!fs.existsSync(this.abs(rel))) return `source "${src}" not found`;
    return undefined;
  }

  /** Changes whenever a fiche, the inbox, the sources or the log change. Cheap: a few stat calls. */
  version(): string {
    let v = 0;
    for (const dir of [LAYOUT.fiches, LAYOUT.inbox, LAYOUT.imports, LAYOUT.sessions]) {
      try {
        const names = fs.readdirSync(this.abs(dir));
        v += names.length * 1e-3;
        for (const n of names) v = Math.max(v, fs.statSync(this.abs(`${dir}/${n}`)).mtimeMs) + names.length * 1e-6;
      } catch {
        // missing folder
      }
    }
    for (const f of [LAYOUT.log, LAYOUT.index]) {
      try {
        v = Math.max(v, fs.statSync(this.abs(f)).mtimeMs);
      } catch {
        // missing file
      }
    }
    return v.toFixed(6);
  }

  // ---------- inbox ----------

  inbox(): InboxItem[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(this.abs(LAYOUT.inbox));
    } catch {
      return [];
    }
    const items: InboxItem[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const st = fs.statSync(this.abs(`${LAYOUT.inbox}/${name}`));
      if (!st.isFile()) continue;
      items.push({
        name,
        path: `${LAYOUT.inbox}/${name}`,
        size: st.size,
        mtimeMs: st.mtimeMs,
        supported: SUPPORTED_INBOX.has(path.extname(name).toLowerCase()),
      });
    }
    return items.sort((a, b) => a.mtimeMs - b.mtimeMs || a.name.localeCompare(b.name));
  }

  private readImports(): Record<string, string> {
    try {
      return JSON.parse(fs.readFileSync(this.abs(LAYOUT.imported), "utf8"));
    } catch {
      return {};
    }
  }

  importedPath(name: string): string | undefined {
    return this.readImports()[name];
  }

  /** Moves an inbox file to sources/imports/ (once) and returns its new path. */
  importItem(name: string): string {
    const known = this.importedPath(name);
    const from = this.abs(`${LAYOUT.inbox}/${name}`);
    if (!fs.existsSync(from)) {
      if (known) return known;
      throw new Error(`"${name}" is not in the inbox`);
    }
    const ext = path.extname(name);
    const stem = path.basename(name, ext);
    let rel = `${LAYOUT.imports}/${name}`;
    for (let i = 2; fs.existsSync(this.abs(rel)); i++) rel = `${LAYOUT.imports}/${stem}-${today()}${i > 2 ? `-${i}` : ""}${ext}`;
    fs.mkdirSync(this.abs(LAYOUT.imports), { recursive: true });
    fs.renameSync(from, this.abs(rel));
    const map = this.readImports();
    map[name] = rel;
    fs.writeFileSync(this.abs(LAYOUT.imported), JSON.stringify(map, null, 2) + "\n");
    return rel;
  }

  // ---------- writing ----------

  private guard(actor: Actor): Problem | undefined {
    if (actor.cwd && isExcluded(actor.cwd, this.config))
      return {
        field: "cwd",
        message: `writes are disabled from ${actor.cwd}: this folder is excluded in .stet/config.toml. Do not capture anything from this session.`,
      };
    return undefined;
  }

  writeFiche(input: FicheInput, actor: Actor): WriteResult {
    const problems: Problem[] = [];
    const g = this.guard(actor);
    if (g) return { ok: false, problems: [g] };

    const title = (input.title ?? "").trim();
    const body = input.body ?? "";
    if (/^\s*---\s*\n/.test(body))
      problems.push({ field: "body", message: "send the body without frontmatter; Stet writes the frontmatter" });

    const existing = title ? this.resolve(title) : undefined;
    const sameTitle = existing && titleKey(existing.fm.title) === titleKey(title) ? existing : undefined;
    if (sameTitle && !input.update)
      problems.push({ field: "title", message: `a fiche titled "${sameTitle.fm.title}" already exists; pass update: true to change it` });
    if (!sameTitle && input.update)
      problems.push({ field: "title", message: `no fiche titled "${title}"; omit update to create it` });

    const fileName = ficheFileName(title);
    if (!sameTitle && title) {
      const clash = this.fiches().find((f) => path.basename(f.path) === fileName);
      if (clash) problems.push({ field: "title", message: `title "${title}" maps to the same file as "${clash.fm.title}"; pick a distinct title` });
      const near = this.fiches().find((f) => looseKey(f.fm.title) === looseKey(title));
      if (near && !clash)
        problems.push({ field: "title", message: `title "${title}" is too close to existing fiche "${near.fm.title}"; update that fiche instead` });
    }

    const sources = [...new Set((input.sources ?? []).map((s) => s.trim()).filter(Boolean))];
    for (const s of sources) {
      const err = this.checkSource(s);
      if (err) problems.push({ field: "sources", message: err });
    }
    const tags = [...new Set((input.tags ?? []).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];

    const missing = extractLinks(body)
      .map((l) => l.target)
      .filter((t) => titleKey(t) !== titleKey(title) && !this.resolve(t));
    for (const t of [...new Set(missing)])
      problems.push({
        field: "body",
        message: `link [[${t}]] points to no fiche; create that fiche first, or remove the link and add it later with update: true`,
      });

    const fm: Frontmatter = {
      title,
      status: "draft",
      sources,
      tags,
      created: sameTitle?.fm.created ?? today(),
      updated: today(),
      session: sameTitle?.fm.session ?? actor.session,
      summary: input.summary?.trim() || sameTitle?.fm.summary,
    };
    const res = FrontmatterSchema.safeParse(fm);
    if (!res.success) problems.push(...zodProblems(res.error));
    if (problems.length) return { ok: false, problems };

    // Inbox files cited as sources move to sources/imports/ on first citation.
    fm.sources = sources.map((s) => {
      const rel = s.replace(/^\.\//, "");
      return rel.startsWith(LAYOUT.inbox + "/") ? this.importItem(rel.slice(LAYOUT.inbox.length + 1)) : s;
    });

    const rel = sameTitle?.path ?? `${LAYOUT.fiches}/${fileName}`;
    fs.writeFileSync(this.abs(rel), serializeFiche(fm, body, sameTitle?.extra));
    const notes: string[] = [];
    if (sameTitle?.fm.status === "validated") notes.push("the fiche was validated; it is back to draft until the user validates it again");
    this.appendLog({ action: sameTitle ? "update" : "create", title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: rel, created: !sameTitle, notes };
  }

  writeSessionNote(input: { title: string; content: string; artefacts?: string[] }, actor: Actor): WriteResult {
    const g = this.guard(actor);
    if (g) return { ok: false, problems: [g] };
    const title = (input.title ?? "").trim();
    const content = (input.content ?? "").trim();
    const problems: Problem[] = [];
    if (!title) problems.push({ field: "title", message: "a session note needs a title" });
    if (!content) problems.push({ field: "content", message: "a session note needs content: what was established and how" });
    if (problems.length) return { ok: false, problems };
    const slug = ficheFileName(title).slice(0, -3).toLowerCase().replace(/\s+/g, "-");
    let rel = `${LAYOUT.sessions}/${today()}-${slug}.md`;
    for (let i = 2; fs.existsSync(this.abs(rel)); i++) rel = `${LAYOUT.sessions}/${today()}-${slug}-${i}.md`;
    const artefacts = (input.artefacts ?? []).map((a) => a.trim()).filter(Boolean);
    const head = [
      "---",
      `title: ${JSON.stringify(title)}`,
      "written_by: agent",
      `session: ${actor.session}`,
      `created: ${new Date().toISOString()}`,
      ...(artefacts.length ? ["artefacts:", ...artefacts.map((a) => `  - ${JSON.stringify(a)}`)] : []),
      "---",
      "",
    ];
    fs.mkdirSync(this.abs(LAYOUT.sessions), { recursive: true });
    fs.writeFileSync(this.abs(rel), head.join("\n") + content + "\n", { flag: "wx" });
    fs.chmodSync(this.abs(rel), 0o444);
    this.appendLog({ action: "session-note", detail: rel, session: actor.session });
    return { ok: true, path: rel, created: true, notes: ["cite this path in the sources of the fiches it supports"] };
  }

  completeItem(name: string, fiches: string[], actor: Actor): WriteResult {
    const g = this.guard(actor);
    if (g) return { ok: false, problems: [g] };
    const clean = name.replace(/^\.\//, "").replace(new RegExp(`^${LAYOUT.inbox}/`), "");
    let rel: string;
    try {
      rel = this.importItem(clean);
    } catch (e) {
      return { ok: false, problems: [{ field: "item", message: (e as Error).message }] };
    }
    const unknown = fiches.filter((t) => !this.resolve(t));
    if (unknown.length)
      return { ok: false, problems: unknown.map((t) => ({ field: "fiches", message: `no fiche titled "${t}"` })) };
    const links = fiches.map((t) => `[[${this.resolve(t)!.fm.title}]]`).join(", ");
    this.appendLog({ action: "import", detail: `${rel} → ${links || "no fiche"}`, session: actor.session });
    return { ok: true, path: rel, created: false, notes: [] };
  }

  setStatus(title: string, status: Status, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no fiche titled "${title}"` }] };
    if (status === "validated" && actor.session !== "user")
      return { ok: false, problems: [{ field: "status", message: "only the user can validate a fiche" }] };
    fs.writeFileSync(this.abs(f.path), serializeFiche({ ...f.fm, status }, f.body, f.extra));
    this.appendLog({ action: status === "validated" ? "validate" : "unvalidate", title: f.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  setTags(title: string, tags: string[], actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no fiche titled "${title}"` }] };
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];
    if (!clean.length) return { ok: false, problems: [{ field: "tags", message: "at least one tag is required" }] };
    fs.writeFileSync(this.abs(f.path), serializeFiche({ ...f.fm, tags: clean }, f.body, f.extra));
    this.appendLog({ action: "tags", title: f.fm.title, detail: clean.join(", "), session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  /** Rejected fiches move to .stet/rejected/, where they can be recovered by hand. */
  reject(title: string, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no fiche titled "${title}"` }] };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rel = `${LAYOUT.rejected}/${stamp} ${path.basename(f.path)}`;
    fs.mkdirSync(this.abs(LAYOUT.rejected), { recursive: true });
    fs.renameSync(this.abs(f.path), this.abs(rel));
    this.appendLog({ action: "reject", title: f.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: rel, created: false, notes: [] };
  }

  // ---------- index ----------

  generateIndex(): string {
    const all = this.fiches();
    const drafts = all.filter((f) => f.fm.status === "draft").length;
    const lines = [
      "# Index",
      "",
      "Generated by Stet from the fiches. Do not edit by hand; `stet lint --fix` rebuilds it.",
      "",
      `${all.length} fiches, ${drafts} to review.`,
      "",
    ];
    const groups = new Map<string, Fiche[]>();
    for (const f of all) {
      const tag = f.fm.tags[0];
      groups.set(tag, [...(groups.get(tag) ?? []), f]);
    }
    for (const tag of [...groups.keys()].sort()) {
      lines.push(`## ${tag}`, "");
      for (const f of groups.get(tag)!) {
        const s = summaryOf(f);
        lines.push(`- [[${f.fm.title}]]${f.fm.status === "draft" ? " (draft)" : ""}${s ? ` — ${s}` : ""}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  writeIndex(): void {
    fs.writeFileSync(this.abs(LAYOUT.index), this.generateIndex());
  }

  indexInSync(): boolean {
    try {
      return fs.readFileSync(this.abs(LAYOUT.index), "utf8") === this.generateIndex();
    } catch {
      return false;
    }
  }

  // ---------- log and usage ----------

  appendLog(e: Omit<LogEntry, "at">): void {
    const at = new Date().toISOString().slice(0, 16).replace("T", " ");
    const parts = [at, e.action];
    if (e.title) parts.push(`[[${e.title}]]`);
    if (e.detail) parts.push(e.detail.replace(/\n/g, " "));
    if (e.session) parts.push(e.session);
    if (!fs.existsSync(this.abs(LAYOUT.log))) fs.writeFileSync(this.abs(LAYOUT.log), "# Log\n\n");
    fs.appendFileSync(this.abs(LAYOUT.log), `- ${parts.join(" · ")}\n`);
  }

  readLog(): LogEntry[] {
    let text = "";
    try {
      text = fs.readFileSync(this.abs(LAYOUT.log), "utf8");
    } catch {
      return [];
    }
    const out: LogEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line.startsWith("- ")) continue;
      const parts = line.slice(2).split(" · ");
      if (parts.length < 2) continue;
      const e: LogEntry = { at: parts[0], action: parts[1] };
      for (const p of parts.slice(2)) {
        const m = p.match(/^\[\[(.+)\]\]$/);
        if (m && !e.title) e.title = m[1];
        else if (/^(s-[\w-]+|user)$/.test(p)) e.session = p;
        else e.detail = e.detail ? `${e.detail} · ${p}` : p;
      }
      out.push(e);
    }
    return out;
  }

  recordRead(title: string, session: string): void {
    fs.mkdirSync(this.abs(LAYOUT.state), { recursive: true });
    fs.appendFileSync(this.abs(LAYOUT.usage), JSON.stringify({ at: new Date().toISOString(), session, title }) + "\n");
  }

  /** A reuse is a fiche read by the agent in a session other than the one that created it. */
  reuse(): { total: number; byTitle: Map<string, number>; recent: { at: string; title: string; session: string }[] } {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(this.abs(LAYOUT.usage), "utf8").split("\n").filter(Boolean);
    } catch {
      // no reads yet
    }
    const seen = new Set<string>();
    const byTitle = new Map<string, number>();
    const recent: { at: string; title: string; session: string }[] = [];
    for (const l of lines) {
      let r: { at: string; session: string; title: string };
      try {
        r = JSON.parse(l);
      } catch {
        continue;
      }
      if (r.session === "user") continue;
      const f = this.resolve(r.title);
      if (!f || !f.fm.session || f.fm.session === r.session) continue;
      const key = `${r.session}|${f.fm.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byTitle.set(f.fm.title, (byTitle.get(f.fm.title) ?? 0) + 1);
      recent.push({ at: r.at, title: f.fm.title, session: r.session });
    }
    return { total: seen.size, byTitle, recent: recent.reverse() };
  }
}
