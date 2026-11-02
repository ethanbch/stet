import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_TOML, LAYOUT, isExcluded, loadConfig, type StetConfig } from "./config.js";
import {
  KINDS,
  FrontmatterSchema,
  cardFileName,
  isExternalSource,
  looseKey,
  parseCard,
  serializeCard,
  summaryOf,
  titleKey,
  today,
  zodProblems,
  type Card,
  type Frontmatter,
  type Problem,
  type Status,
} from "./card.js";
import { extractLinks, type WikiLink } from "./links.js";

export const MAX_INBOX_BYTES = 2_000_000;
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

/** A card the agent read in a later session than the one that wrote it. */
export interface Recall {
  at: string;
  title: string;
  session: string;
  /** Folder the agent worked in. */
  project?: string;
  /** What it searched for, when the card came from a search. */
  query?: string;
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

export interface CardInput {
  title: string;
  body: string;
  sources: string[];
  tags: string[];
  /** One of KINDS. On update, omitted keeps the card's kind. */
  kind?: string;
  /** One of the wiki's projects, or the current folder's name (added to the list). On update, omitted keeps it. */
  project?: string;
  summary?: string;
  update?: boolean;
}

interface CacheEntry {
  mtimeMs: number;
  card?: Card;
  invalid?: InvalidFile;
  links: WikiLink[];
}

const SCAN_TTL = 500;

const TEMPLATES = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "templates");

export class Vault {
  readonly root: string;
  config: StetConfig;
  private cache = new Map<string, CacheEntry>();
  private scannedAt = 0;
  private sorted: Card[] = [];
  private byKey = new Map<string, Card>();
  private byFile = new Map<string, Card>();

  constructor(root: string) {
    this.root = path.resolve(root);
    this.config = loadConfig(this.root);
    this.migrateFolders();
  }

  /** Wikis made before cards had their name keep them in fiches/: move that folder to cards/, once. */
  private migrateFolders(): void {
    const old = this.abs("fiches");
    const now = this.abs(LAYOUT.cards);
    try {
      if (fs.existsSync(old) && !fs.existsSync(now)) fs.renameSync(old, now);
    } catch {
      // read-only or busy: the next start tries again
    }
  }

  abs(rel: string): string {
    return path.join(this.root, rel);
  }

  isInitialized(): boolean {
    return fs.existsSync(this.abs(LAYOUT.cards)) && fs.existsSync(this.abs(LAYOUT.state));
  }

  /** Creates the folder layout. Existing files are never overwritten. */
  init(): string[] {
    const created: string[] = [];
    for (const dir of [LAYOUT.inbox, LAYOUT.imports, LAYOUT.sessions, LAYOUT.cards, LAYOUT.rejected]) {
      if (!fs.existsSync(this.abs(dir))) {
        fs.mkdirSync(this.abs(dir), { recursive: true });
        created.push(dir + "/");
      }
    }
    const files: [string, () => string][] = [
      [LAYOUT.config, () => DEFAULT_CONFIG_TOML],
      [LAYOUT.agents, () => fs.readFileSync(path.join(TEMPLATES, "AGENTS.md"), "utf8")],
      [".gitignore", () => ".stet/*\n!.stet/config.toml\n!.stet/usage.jsonl\n!.stet/imports.json\n!.stet/projects.json\n"],
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

  /** Our own writes call this; edits from other programs show up within SCAN_TTL. */
  private invalidate(): void {
    this.scannedAt = 0;
  }

  /** Forces a fresh look at the files, e.g. before a full check. */
  refresh(): void {
    this.invalidate();
    this.scanFiles();
  }

  private scanFiles(): void {
    if (Date.now() - this.scannedAt < SCAN_TTL) return;
    this.scannedAt = Date.now();
    const dir = this.abs(LAYOUT.cards);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && !n.startsWith("."));
    } catch {
      this.cache.clear();
      return;
    }
    const seen = new Set<string>();
    for (const name of names) {
      const rel = `${LAYOUT.cards}/${name}`;
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
      const parsed = parseCard(text, rel, st.mtimeMs);
      const body = parsed.card?.body ?? text;
      this.cache.set(rel, {
        mtimeMs: st.mtimeMs,
        card: parsed.card,
        invalid: parsed.card ? undefined : { path: rel, title: parsed.title, problems: parsed.problems },
        links: extractLinks(body),
      });
    }
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
    this.sorted = [...this.cache.values()]
      .flatMap((e) => (e.card ? [e.card] : []))
      .sort((a, b) => a.fm.title.localeCompare(b.fm.title));
    this.byKey = new Map();
    this.byFile = new Map();
    for (const f of this.sorted) {
      if (!this.byKey.has(titleKey(f.fm.title))) this.byKey.set(titleKey(f.fm.title), f);
      this.byFile.set(titleKey(path.basename(f.path, ".md")), f);
    }
  }

  cards(): Card[] {
    this.scanFiles();
    return this.sorted;
  }

  invalidFiles(): InvalidFile[] {
    this.scanFiles();
    return [...this.cache.values()].flatMap((e) => (e.invalid ? [e.invalid] : []));
  }

  linksOf(f: Card): WikiLink[] {
    this.scanFiles();
    return this.cache.get(f.path)?.links ?? extractLinks(f.body);
  }

  /** Finds a card by title, then by file name (what Obsidian does). */
  resolve(target: string): Card | undefined {
    this.scanFiles();
    const key = titleKey(target).replace(/^cards\//, "").replace(/\.md$/, "");
    return this.byKey.get(key) ?? this.byFile.get(key);
  }

  backlinks(f: Card): Card[] {
    return this.cards().filter(
      (o) => o.path !== f.path && this.linksOf(o).some((l) => this.resolve(l.target)?.path === f.path),
    );
  }

  /** A local source: inside the vault, under sources/ or inbox/, and present. */
  checkSource(src: string): string | undefined {
    if (isExternalSource(src)) return undefined;
    const rel = path.posix.normalize(src.replace(/\\/g, "/").replace(/^\.\//, ""));
    if (rel.startsWith("..") || path.isAbsolute(rel)) return `source "${src}" is outside the vault`;
    if (rel.startsWith(LAYOUT.cards + "/"))
      return `source "${src}" is a card; cite raw sources and link cards with [[...]] in the body`;
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

  /** Changes whenever a card, the inbox, the sources or the log change. Cheap: a few stat calls. */
  version(): string {
    let v = 0;
    for (const dir of [LAYOUT.cards, LAYOUT.inbox, LAYOUT.imports, LAYOUT.sessions]) {
      try {
        const names = fs.readdirSync(this.abs(dir));
        v += names.length * 1e-3;
        for (const n of names) v = Math.max(v, fs.statSync(this.abs(`${dir}/${n}`)).mtimeMs) + names.length * 1e-6;
      } catch {
        // missing folder
      }
    }
    for (const f of [LAYOUT.log, LAYOUT.index, LAYOUT.agent]) {
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

  writeCard(input: CardInput, actor: Actor): WriteResult {
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
      problems.push({ field: "title", message: `a card titled "${sameTitle.fm.title}" already exists; pass update: true to change it` });
    if (!sameTitle && input.update)
      problems.push({ field: "title", message: `no card titled "${title}"; omit update to create it` });

    const fileName = cardFileName(title);
    if (!sameTitle && title) {
      const clash = this.cards().find((f) => path.basename(f.path) === fileName);
      if (clash) problems.push({ field: "title", message: `title "${title}" maps to the same file as "${clash.fm.title}"; pick a distinct title` });
      const near = this.cards().find((f) => looseKey(f.fm.title) === looseKey(title));
      if (near && !clash)
        problems.push({ field: "title", message: `title "${title}" is too close to existing card "${near.fm.title}"; update that card instead` });
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
        message: `link [[${t}]] points to no card; create that card first, or remove the link and add it later with update: true`,
      });

    const kind = (input.kind?.trim().toLowerCase() || sameTitle?.fm.kind) as Frontmatter["kind"];
    let project = sameTitle?.fm.project;
    if (input.project?.trim()) {
      const p = this.resolveProject(input.project, actor);
      if (p.ok) project = p.name;
      else problems.push({ field: "project", message: p.message });
    }

    const fm: Frontmatter = {
      title,
      status: "draft",
      sources,
      tags,
      kind,
      project,
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

    const rel = sameTitle?.path ?? `${LAYOUT.cards}/${fileName}`;
    // Keep the text the user validated, so the review can show what the agent changed.
    if (sameTitle?.fm.status === "validated") {
      fs.mkdirSync(this.abs(LAYOUT.validated), { recursive: true });
      fs.copyFileSync(this.abs(sameTitle.path), this.snapshotPath(sameTitle));
    }
    fs.writeFileSync(this.abs(rel), serializeCard(fm, body, sameTitle?.extra));
    if (project) this.addProjectToList(project);
    this.invalidate();
    const notes: string[] = [];
    if (sameTitle?.fm.status === "validated") notes.push("the card was validated; it is back to draft until the user validates it again");
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
    const slug = cardFileName(title).slice(0, -3).toLowerCase().replace(/\s+/g, "-");
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
    return { ok: true, path: rel, created: true, notes: ["cite this path in the sources of the cards it supports"] };
  }

  completeItem(name: string, cards: string[], actor: Actor): WriteResult {
    const g = this.guard(actor);
    if (g) return { ok: false, problems: [g] };
    const clean = name.replace(/^\.\//, "").replace(new RegExp(`^${LAYOUT.inbox}/`), "");
    let rel: string;
    try {
      rel = this.importItem(clean);
    } catch (e) {
      return { ok: false, problems: [{ field: "item", message: (e as Error).message }] };
    }
    const unknown = cards.filter((t) => !this.resolve(t));
    if (unknown.length)
      return { ok: false, problems: unknown.map((t) => ({ field: "cards", message: `no card titled "${t}"` })) };
    const links = cards.map((t) => `[[${this.resolve(t)!.fm.title}]]`).join(", ");
    this.appendLog({ action: "import", detail: `${rel} → ${links || "no card"}`, session: actor.session });
    return { ok: true, path: rel, created: false, notes: [] };
  }

  setStatus(title: string, status: Status, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no card titled "${title}"` }] };
    if (status === "validated" && actor.session !== "user")
      return { ok: false, problems: [{ field: "status", message: "only the user can validate a card" }] };
    fs.writeFileSync(this.abs(f.path), serializeCard({ ...f.fm, status }, f.body, f.extra));
    if (status === "validated") fs.rmSync(this.snapshotPath(f), { force: true });
    this.invalidate();
    this.appendLog({ action: status === "validated" ? "validate" : "unvalidate", title: f.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  /**
   * The user edits a card's text in the interface. Links must point to existing cards, as for the agent.
   * The status stays: the user wrote it. `base` is the text the editor opened, to refuse a save over a newer change.
   */
  editBody(title: string, body: string, base: string | undefined, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no card titled "${title}"` }] };
    if (actor.session !== "user") return { ok: false, problems: [{ field: "body", message: "only the user edits from the interface" }] };
    if (base !== undefined && base !== f.body)
      return { ok: false, problems: [{ field: "body", message: "the card changed since you opened the editor (your agent or another window); copy your text, cancel and edit again" }] };
    const text = body.replace(/\r\n/g, "\n").replace(/\s+$/, "") + "\n";
    const problems: Problem[] = [];
    if (/^\s*---\s*\n/.test(text)) problems.push({ field: "body", message: "remove the frontmatter block; Stet keeps it" });
    if (!text.trim()) problems.push({ field: "body", message: "the text is empty; reject the card instead" });
    const missing = extractLinks(text)
      .map((l) => l.target)
      .filter((t) => titleKey(t) !== titleKey(f.fm.title) && !this.resolve(t));
    for (const t of [...new Set(missing)]) problems.push({ field: "body", message: `[[${t}]] points to no card; fix the title or remove the brackets` });
    if (problems.length) return { ok: false, problems };
    if (text === f.body) return { ok: true, path: f.path, created: false, notes: ["no change"] };
    fs.writeFileSync(this.abs(f.path), serializeCard({ ...f.fm, updated: today() }, text, f.extra));
    this.invalidate();
    this.appendLog({ action: "edit", title: f.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  // ---------- projects ----------

  /** The wiki's projects: the saved list plus any project a card uses, sorted. */
  projects(): string[] {
    const saved = this.savedProjects();
    const all = new Map<string, string>();
    for (const p of [...saved, ...this.cards().map((c) => c.fm.project).filter((x): x is string => !!x)]) {
      if (!all.has(p.toLowerCase())) all.set(p.toLowerCase(), p);
    }
    return [...all.values()].sort((a, b) => a.localeCompare(b));
  }

  private savedProjects(): string[] {
    try {
      const raw = JSON.parse(fs.readFileSync(this.abs(LAYOUT.projects), "utf8"));
      return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string" && !!x.trim()) : [];
    } catch {
      return [];
    }
  }

  /** Saves a project in .stet/projects.json, once whatever the case. */
  private addProjectToList(name: string): void {
    if (this.savedProjects().some((p) => p.toLowerCase() === name.toLowerCase())) return;
    fs.mkdirSync(this.abs(LAYOUT.state), { recursive: true });
    const next = [...new Set([...this.projects(), name])].sort((a, b) => a.localeCompare(b));
    fs.writeFileSync(this.abs(LAYOUT.projects), JSON.stringify(next, null, 2) + "\n");
  }

  /** The user adds a project to the list from the interface. */
  addProject(name: string, actor: Actor): WriteResult {
    const clean = name.trim();
    if (!clean || clean.length > 60 || /[\n\r]/.test(clean))
      return { ok: false, problems: [{ field: "project", message: "a project name is 1 to 60 characters, on one line" }] };
    if (this.projects().some((p) => p.toLowerCase() === clean.toLowerCase()))
      return { ok: false, problems: [{ field: "project", message: `"${clean}" is already in the list` }] };
    this.addProjectToList(clean);
    this.appendLog({ action: "project", detail: clean, session: actor.session });
    return { ok: true, path: LAYOUT.projects, created: true, notes: [] };
  }

  /**
   * A project name from the agent: an existing project (any case), or the name of the folder it works in,
   * which joins the list. Anything else is refused, so the list stays the user's.
   */
  private resolveProject(name: string, actor: Actor): { ok: true; name: string } | { ok: false; message: string } {
    const clean = name.trim();
    const known = this.projects().find((p) => p.toLowerCase() === clean.toLowerCase());
    if (known) return { ok: true, name: known };
    if (actor.session === "user" || (actor.cwd && path.basename(actor.cwd).toLowerCase() === clean.toLowerCase()))
      return { ok: true, name: actor.session === "user" ? clean : path.basename(actor.cwd!) };
    const list = this.projects();
    return {
      ok: false,
      message: `unknown project "${clean}"; use one of: ${list.length ? list.join(", ") : "(none yet)"}, or the current folder's name, or leave it out`,
    };
  }

  /** The user changes a card's kind or project (null clears it). The status stays. */
  setMeta(title: string, meta: { kind?: string | null; project?: string | null }, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no card titled "${title}"` }] };
    const fm = { ...f.fm };
    if (meta.kind !== undefined) {
      if (meta.kind !== null && !(KINDS as readonly string[]).includes(meta.kind))
        return { ok: false, problems: [{ field: "kind", message: `kind must be one of: ${KINDS.join(", ")}` }] };
      fm.kind = (meta.kind ?? undefined) as Frontmatter["kind"];
    }
    if (meta.project !== undefined) {
      if (meta.project === null) fm.project = undefined;
      else {
        const known = this.projects().find((p) => p.toLowerCase() === meta.project!.trim().toLowerCase());
        if (!known) return { ok: false, problems: [{ field: "project", message: `"${meta.project}" is not in the projects list; add it first` }] };
        fm.project = known;
      }
    }
    fs.writeFileSync(this.abs(f.path), serializeCard(fm, f.body, f.extra));
    this.invalidate();
    this.appendLog({ action: "meta", title: f.fm.title, detail: [fm.kind, fm.project].filter(Boolean).join(" · "), session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  setTags(title: string, tags: string[], actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no card titled "${title}"` }] };
    const clean = [...new Set(tags.map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean))];
    if (!clean.length) return { ok: false, problems: [{ field: "tags", message: "at least one tag is required" }] };
    fs.writeFileSync(this.abs(f.path), serializeCard({ ...f.fm, tags: clean }, f.body, f.extra));
    this.invalidate();
    this.appendLog({ action: "tags", title: f.fm.title, detail: clean.join(", "), session: actor.session });
    this.writeIndex();
    return { ok: true, path: f.path, created: false, notes: [] };
  }

  /** Rejected cards move to .stet/rejected/, where they can be recovered by hand. */
  reject(title: string, actor: Actor): WriteResult {
    const f = this.resolve(title);
    if (!f) return { ok: false, problems: [{ field: "title", message: `no card titled "${title}"` }] };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rel = `${LAYOUT.rejected}/${stamp} ${path.basename(f.path)}`;
    fs.mkdirSync(this.abs(LAYOUT.rejected), { recursive: true });
    fs.renameSync(this.abs(f.path), this.abs(rel));
    fs.rmSync(this.snapshotPath(f), { force: true });
    this.invalidate();
    this.appendLog({ action: "reject", title: f.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: rel, created: false, notes: [] };
  }

  private snapshotPath(f: Card): string {
    return this.abs(`${LAYOUT.validated}/${path.basename(f.path)}`);
  }

  /** The text of a card as the user last validated it, when the agent changed it since. */
  previousValidated(f: Card): { title: string; body: string; tags: string[] } | undefined {
    try {
      const { card } = parseCard(fs.readFileSync(this.snapshotPath(f), "utf8"), f.path);
      return card && { title: card.fm.title, body: card.body, tags: card.fm.tags };
    } catch {
      return undefined;
    }
  }

  /** Rejected cards, newest first. `file` is the name inside .stet/rejected/. */
  listRejected(): { file: string; title: string; at: string; summary: string }[] {
    const dir = this.abs(LAYOUT.rejected);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      return [];
    }
    const out = [];
    for (const file of names) {
      const { card, title } = parseCard(fs.readFileSync(path.join(dir, file), "utf8"), `${LAYOUT.rejected}/${file}`);
      // Name format: 2026-11-02T21-37-02-290Z Title.md
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z /.exec(file);
      const at = m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : "";
      out.push({ file, title: title ?? file, at, summary: card ? summaryOf(card) : "" });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Inbox files your agent already turned into cards: the original name, where the file went
   * (sources/imports/), and the cards that cite it. Newest first.
   */
  processedInbox(): { name: string; path: string; at: string; cards: string[]; validated: number }[] {
    const cards = this.cards();
    return Object.entries(this.readImports())
      .map(([name, rel]) => {
        let at = "";
        try {
          at = new Date(fs.statSync(this.abs(rel)).mtimeMs).toISOString();
        } catch {
          // the imported file was moved or deleted by hand
        }
        const from = cards.filter((f) => f.fm.sources.includes(rel));
        return { name, path: rel, at, cards: from.map((f) => f.fm.title), validated: from.filter((f) => f.fm.status === "validated").length };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /** The text of a file waiting in the inbox. */
  readInbox(name: string): string | undefined {
    const base = path.basename(name);
    if (base !== name || base.startsWith(".")) return undefined;
    try {
      return fs.readFileSync(this.abs(`${LAYOUT.inbox}/${base}`), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Takes a file out of the inbox, into .stet/removed/, where it can be recovered by hand. */
  removeFromInbox(name: string, actor: Actor): WriteResult {
    const base = path.basename(name);
    const from = this.abs(`${LAYOUT.inbox}/${base}`);
    if (base !== name || !fs.existsSync(from)) return { ok: false, problems: [{ field: "name", message: `"${name}" is not in the inbox` }] };
    fs.mkdirSync(this.abs(LAYOUT.removed), { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.renameSync(from, this.abs(`${LAYOUT.removed}/${stamp} ${base}`));
    this.appendLog({ action: "inbox-remove", detail: base, session: actor.session });
    return { ok: true, path: `${LAYOUT.removed}/${stamp} ${base}`, created: false, notes: [] };
  }

  /** Adds a text file to the inbox from the interface. Never overwrites: a taken name gets a number. */
  addToInbox(name: string, content: string, actor: Actor): WriteResult {
    const ext = path.extname(name).toLowerCase();
    if (!SUPPORTED_INBOX.has(ext))
      return { ok: false, problems: [{ field: "name", message: `${ext || "no extension"}: use ${[...SUPPORTED_INBOX].join(", ")}` }] };
    if (Buffer.byteLength(content, "utf8") > MAX_INBOX_BYTES)
      return { ok: false, problems: [{ field: "content", message: `larger than ${MAX_INBOX_BYTES / 1_000_000} MB` }] };
    if (!content.trim()) return { ok: false, problems: [{ field: "content", message: "the file is empty" }] };
    // Keep the name readable but safe: no folders, no hidden files, no odd characters.
    const stem =
      path
        .basename(name, path.extname(name))
        .replace(/[^\p{L}\p{N} ._()-]+/gu, "-")
        .replace(/^[.\s-]+/, "")
        .slice(0, 80) || "note";
    fs.mkdirSync(this.abs(LAYOUT.inbox), { recursive: true });
    let file = `${stem}${ext}`;
    for (let n = 2; fs.existsSync(this.abs(`${LAYOUT.inbox}/${file}`)); n++) file = `${stem} ${n}${ext}`;
    fs.writeFileSync(this.abs(`${LAYOUT.inbox}/${file}`), content, { flag: "wx" });
    this.appendLog({ action: "inbox", detail: file, session: actor.session });
    return { ok: true, path: `${LAYOUT.inbox}/${file}`, created: true, notes: [] };
  }

  /** A rejected card, read-only, by its name inside .stet/rejected/. */
  readRejected(file: string): Card | undefined {
    const name = path.basename(file);
    if (name !== file || !name.endsWith(".md")) return undefined;
    try {
      return parseCard(fs.readFileSync(this.abs(`${LAYOUT.rejected}/${name}`), "utf8"), `${LAYOUT.rejected}/${name}`).card;
    } catch {
      return undefined;
    }
  }

  /** Moves a rejected card back into cards/, as a draft. */
  restore(file: string, actor: Actor): WriteResult {
    const name = path.basename(file);
    const from = this.abs(`${LAYOUT.rejected}/${name}`);
    if (name !== file || !name.endsWith(".md") || !fs.existsSync(from))
      return { ok: false, problems: [{ field: "file", message: `no rejected card named "${file}"` }] };
    const { card, title } = parseCard(fs.readFileSync(from, "utf8"), `${LAYOUT.rejected}/${name}`);
    if (!card) return { ok: false, problems: [{ field: "file", message: `${name} is not a valid card` }] };
    const taken = this.resolve(card.fm.title);
    if (taken)
      return { ok: false, problems: [{ field: "title", message: `a card titled "${taken.fm.title}" exists; rename or reject it first` }] };
    const rel = `${LAYOUT.cards}/${cardFileName(card.fm.title)}`;
    fs.writeFileSync(this.abs(rel), serializeCard({ ...card.fm, status: "draft" }, card.body, card.extra));
    fs.rmSync(from);
    this.invalidate();
    this.appendLog({ action: "restore", title: title ?? card.fm.title, session: actor.session });
    this.writeIndex();
    return { ok: true, path: rel, created: true, notes: [] };
  }

  /** Titles of cards moved to .stet/rejected/, keyed by titleKey, so lint can name them. */
  rejectedTitles(): Map<string, string> {
    const out = new Map<string, string>();
    const dir = this.abs(LAYOUT.rejected);
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter((n) => n.endsWith(".md"));
    } catch {
      return out;
    }
    for (const n of names) {
      const { title } = parseCard(fs.readFileSync(path.join(dir, n), "utf8"), `${LAYOUT.rejected}/${n}`);
      if (title) out.set(titleKey(title), title);
    }
    return out;
  }

  // ---------- index ----------

  generateIndex(): string {
    const all = this.cards();
    const drafts = all.filter((f) => f.fm.status === "draft").length;
    const lines = [
      "# Index",
      "",
      "Generated by Stet from the cards. Do not edit by hand; `stet lint --fix` rebuilds it.",
      "",
      `${all.length} cards, ${drafts} to review.`,
      "",
    ];
    const groups = new Map<string, Card[]>();
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

  /** Called when an agent session starts the MCP server; the setup guide reads it. */
  recordAgentSession(session: string, cwd?: string): void {
    const prev = this.agentInfo();
    fs.mkdirSync(this.abs(LAYOUT.state), { recursive: true });
    const info = {
      first_seen: prev?.first_seen ?? new Date().toISOString(),
      last_seen: new Date().toISOString(),
      last_session: session,
      last_folder: cwd ? path.basename(cwd) : undefined,
      sessions: (prev?.sessions ?? 0) + 1,
    };
    fs.writeFileSync(this.abs(LAYOUT.agent), JSON.stringify(info, null, 2) + "\n");
  }

  agentInfo(): { first_seen: string; last_seen: string; last_folder?: string; sessions: number } | undefined {
    try {
      return JSON.parse(fs.readFileSync(this.abs(LAYOUT.agent), "utf8"));
    } catch {
      return undefined;
    }
  }

  /** `project` is the folder the agent worked in; `query` what it searched for, when it searched. */
  recordRead(title: string, session: string, via: "read" | "search" = "read", context: { project?: string; query?: string } = {}): void {
    fs.mkdirSync(this.abs(LAYOUT.state), { recursive: true });
    const entry = { at: new Date().toISOString(), session, title, via, ...context };
    fs.appendFileSync(this.abs(LAYOUT.usage), JSON.stringify(entry) + "\n");
  }

  /**
   * A reuse is a card the agent read, or got as the best search hit, in a session other than the one
   * that created it. Counted once per session and card.
   */
  reuse(): { total: number; byTitle: Map<string, number>; recent: Recall[]; byCard: Map<string, Recall[]> } {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(this.abs(LAYOUT.usage), "utf8").split("\n").filter(Boolean);
    } catch {
      // no reads yet
    }
    const seen = new Set<string>();
    const byTitle = new Map<string, number>();
    const recent: Recall[] = [];
    const byCard = new Map<string, Recall[]>();
    for (const l of lines) {
      let r: { at: string; session: string; title: string; project?: string; query?: string };
      try {
        r = JSON.parse(l);
      } catch {
        continue;
      }
      if (r.session === "user") continue;
      const f = this.resolve(r.title);
      if (!f || !f.fm.session || f.fm.session === r.session) continue;
      const key = `${r.session}|${f.fm.title}`;
      const recall: Recall = { at: r.at, title: f.fm.title, session: r.session, project: r.project, query: r.query };
      if (seen.has(key)) {
        // Same session, same card: one recall; keep the query if the first entry had none.
        const prev = byCard.get(f.fm.title)?.find((x) => x.session === r.session);
        if (prev && !prev.query && r.query) prev.query = r.query;
        continue;
      }
      seen.add(key);
      byTitle.set(f.fm.title, (byTitle.get(f.fm.title) ?? 0) + 1);
      recent.push(recall);
      byCard.set(f.fm.title, [...(byCard.get(f.fm.title) ?? []), recall]);
    }
    for (const list of byCard.values()) list.reverse();
    return { total: seen.size, byTitle, recent: recent.reverse(), byCard };
  }
}
