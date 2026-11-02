import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { isExcluded } from "./config.js";
import { KINDS, summaryOf } from "./card.js";
import { lint } from "./lint.js";
import { search } from "./search.js";
import { Vault, type Actor, type WriteResult } from "./vault.js";

export const INSTRUCTIONS = `Stet is the user's personal wiki: markdown cards you write and maintain for them. Stet validates every write; you write and judge.
- During any work session, when something durable happens (a decision and its reason, a problem solved, a fact learned), propose once per session to keep it in Stet. When the user says "keep this" or types /stet: write_session_note, then search, then write_card (update an existing card rather than duplicating).
- Before answering a question the wiki may cover, search then read, and cite cards by title.
- Every card needs at least one source (a path under sources/ or inbox/, or a URL) and one topic tag. Set its kind (decision, fix, fact, how-to, reference) and, for a session capture, its project (status.project); for an inbox file, set a project only when the file clearly belongs to one of status.projects. You always write drafts; only the user validates and can change any of these.
- If a write is refused, fix the listed problems and retry without asking the user.
- Call status at the start of every session. If it says capture is disabled here, never propose or write anything.
- If status shows files waiting in the inbox and capture is allowed, process them first, without asking: queue_next, write the cards each file supports, complete_item, until the queue is empty. Then tell the user in one line what the files became (drafts waiting for their review in Stet), and go on with their request.
- Full rules: AGENTS.md at the wiki root (read it with read, path "AGENTS.md").`;

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (v: unknown) => text(JSON.stringify(v, null, 2));

function result(r: WriteResult) {
  if (r.ok) return json({ ok: true, path: r.path, created: r.created, notes: r.notes });
  return {
    ...text(
      "Refused. Fix these problems and retry:\n" + r.problems.map((p) => `- ${p.field}: ${p.message}`).join("\n"),
    ),
    isError: true,
  };
}

function page(s: string, offset: number, limit: number) {
  const chunk = s.slice(offset, offset + limit);
  const next = offset + chunk.length < s.length ? offset + chunk.length : null;
  return { chunk, next_offset: next, total_chars: s.length };
}

export function newSessionId(): string {
  return `s-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
}

export function createServer(vault: Vault, actor: Actor): McpServer {
  const server = new McpServer({ name: "stet", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const project = actor.cwd ? path.basename(actor.cwd) : undefined;
  let lastQuery: string | undefined;
  const captureOff = () => (actor.cwd ? isExcluded(actor.cwd, vault.config) : false);
  // In an excluded folder (an employer's repo), the wiki keeps that a card was read, not where or for what.
  const context = (query?: string) => (captureOff() ? {} : { project, query });

  server.registerTool(
    "status",
    {
      description: "Summary of the wiki: items waiting in the inbox, drafts to review, lint problems, and whether capture is allowed in the current folder. Call it at the start of a session that touches the wiki.",
      inputSchema: {},
    },
    async () => {
      const cards = vault.cards();
      const issues = lint(vault);
      const inbox = vault.inbox();
      return json({
        wiki: vault.root,
        session: actor.session,
        capture_allowed: !captureOff(),
        // The folder this session works in, as a project name for session captures (none in an excluded folder).
        project: captureOff() ? null : (project ?? null),
        projects: vault.projects(),
        kinds: KINDS,
        cards: cards.length,
        drafts: cards.filter((f) => f.fm.status === "draft").length,
        inbox_waiting: inbox.filter((i) => i.supported).length,
        inbox_unsupported: inbox.filter((i) => !i.supported).length,
        lint: {
          errors: issues.filter((i) => i.severity === "error").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        },
        reuses: vault.reuse().total,
        next:
          !captureOff() && inbox.some((i) => i.supported)
            ? `Process the ${inbox.filter((i) => i.supported).length} inbox file(s) now, before the user's request: queue_next, write_card, complete_item until empty. Then say in one line what they became.`
            : undefined,
      });
    },
  );

  server.registerTool(
    "queue_next",
    {
      description: "Oldest supported item waiting in the inbox, with its content (paginated). Write the cards it supports citing it as inbox/<name>, then call complete_item.",
      inputSchema: {
        offset: z.number().int().min(0).default(0).describe("Character offset, from next_offset"),
        limit: z.number().int().min(500).max(40000).default(12000),
      },
    },
    async ({ offset, limit }) => {
      const items = vault.inbox();
      const item = items.find((i) => i.supported);
      if (!item) return json({ empty: true, unsupported: items.filter((i) => !i.supported).map((i) => i.name) });
      const content = fs.readFileSync(vault.abs(item.path), "utf8");
      return json({
        item: item.name,
        cite_as: item.path,
        waiting: items.filter((i) => i.supported).length,
        ...page(content, offset, limit),
      });
    },
  );

  server.registerTool(
    "search",
    {
      description: "Full-text search over the cards. Returns titles, status, tags, summary and an excerpt.",
      inputSchema: { query: z.string().min(1), limit: z.number().int().min(1).max(50).default(10) },
    },
    async ({ query, limit }) => {
      const hits = search(vault.cards(), query, limit);
      lastQuery = query;
      // The best hit's summary and excerpt reach the agent: count it as a use, like a read.
      if (hits[0]) vault.recordRead(hits[0].title, actor.session, "search", context(query));
      return json(hits);
    },
  );

  server.registerTool(
    "read",
    {
      description: "Read a card by title, or any file of the wiki by path (a source, AGENTS.md). Content is paginated.",
      inputSchema: {
        title: z.string().optional().describe("Card title"),
        path: z.string().optional().describe("Path relative to the wiki root, e.g. sources/sessions/x.md"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(500).max(40000).default(12000),
      },
    },
    async ({ title, path: rel, offset, limit }) => {
      if (title) {
        const f = vault.resolve(title);
        if (!f) return { ...text(`No card titled "${title}". Try search.`), isError: true };
        // A read usually follows a search: keep that query so the user sees why the card was recalled.
        vault.recordRead(f.fm.title, actor.session, "read", context(lastQuery));
        return json({
          title: f.fm.title,
          path: f.path,
          status: f.fm.status,
          tags: f.fm.tags,
          sources: f.fm.sources,
          created: f.fm.created,
          updated: f.fm.updated,
          links_here: vault.backlinks(f).map((b) => b.fm.title),
          ...page(f.body, offset, limit),
        });
      }
      if (rel) {
        const clean = rel.replace(/^\.\//, "");
        if (clean.startsWith("..") || clean.startsWith("/") || clean.startsWith(".stet"))
          return { ...text("Path must be inside the wiki."), isError: true };
        let content: string;
        try {
          content = fs.readFileSync(vault.abs(clean), "utf8");
        } catch {
          return { ...text(`No file at "${clean}".`), isError: true };
        }
        return json({ path: clean, ...page(content, offset, limit) });
      }
      return { ...text("Pass a title or a path."), isError: true };
    },
  );

  server.registerTool(
    "index",
    {
      description: "Paginated catalogue of cards: title, status, tags, summary. Optionally filtered by tag or status.",
      inputSchema: {
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50),
        tag: z.string().optional(),
        status: z.enum(["draft", "validated"]).optional(),
      },
    },
    async ({ offset, limit, tag, status }) => {
      const all = vault
        .cards()
        .filter((f) => (!tag || f.fm.tags.includes(tag.toLowerCase())) && (!status || f.fm.status === status));
      const slice = all.slice(offset, offset + limit);
      return json({
        total: all.length,
        next_offset: offset + slice.length < all.length ? offset + slice.length : null,
        cards: slice.map((f) => ({ title: f.fm.title, status: f.fm.status, tags: f.fm.tags, summary: summaryOf(f) })),
      });
    },
  );

  server.registerTool(
    "write_card",
    {
      description: "Create a card, or update one with update: true. Refused with a list of problems if the format is wrong. Always written as a draft.",
      inputSchema: {
        title: z.string().describe("Unique title; also the file name"),
        body: z.string().describe("Markdown body without frontmatter; link cards with [[Title]]"),
        sources: z.array(z.string()).describe("At least one: paths under sources/ or inbox/, or URLs"),
        tags: z.array(z.string()).describe("At least one topic tag, free: postgres, auth, testing"),
        kind: z.enum(KINDS).optional().describe("What the card holds; set it on every new card"),
        project: z
          .string()
          .optional()
          .describe("The project it belongs to: status.project for a session capture, or one of status.projects. Leave out when none fits"),
        summary: z.string().optional().describe("One line for the index"),
        update: z.boolean().default(false).describe("true to replace an existing card"),
      },
    },
    async (input) => result(vault.writeCard(input, actor)),
  );

  server.registerTool(
    "write_session_note",
    {
      description: "Write an immutable session note under sources/sessions/: what was established in this session and how. Returns the path to cite in cards.",
      inputSchema: {
        title: z.string(),
        content: z.string().describe("Markdown: what was decided or learned, and the reasoning"),
        artefacts: z.array(z.string()).optional().describe("File paths with commit, URLs, tickets"),
      },
    },
    async (input) => result(vault.writeSessionNote(input, actor)),
  );

  server.registerTool(
    "complete_item",
    {
      description: "Mark an inbox item as processed: move it to sources/imports/ and log which cards it produced (empty list if none).",
      inputSchema: { item: z.string().describe("File name in the inbox"), cards: z.array(z.string()).default([]) },
    },
    async ({ item, cards }) => result(vault.completeItem(item, cards, actor)),
  );

  server.registerTool(
    "log",
    {
      description: "Add an entry to log.md, e.g. after a deep check or to record a decision about the wiki itself.",
      inputSchema: { message: z.string().min(1), title: z.string().optional().describe("Related card, if any") },
    },
    async ({ message, title }) => {
      if (captureOff()) return { ...text("Writes are disabled from this folder."), isError: true };
      const f = title ? vault.resolve(title) : undefined;
      vault.appendLog({ action: "note", title: f?.fm.title, detail: message, session: actor.session });
      return json({ ok: true });
    },
  );

  server.registerTool(
    "lint",
    {
      description: "Mechanical checks: invalid cards, broken links, missing sources, orphans, duplicates, index out of sync, stale inbox items and drafts. Paginated.",
      inputSchema: { offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(200).default(50) },
    },
    async ({ offset, limit }) => {
      const issues = lint(vault);
      return json({
        total: issues.length,
        next_offset: offset + limit < issues.length ? offset + limit : null,
        issues: issues.slice(offset, offset + limit),
      });
    },
  );

  return server;
}

export async function runMcp(vault: Vault): Promise<void> {
  const actor: Actor = { session: newSessionId(), cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd() };
  const server = createServer(vault, actor);
  try {
    vault.recordAgentSession(actor.session, actor.cwd);
  } catch {
    // a read-only wiki still serves reads
  }
  await server.connect(new StdioServerTransport());
}
