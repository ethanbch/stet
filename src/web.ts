import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Hono, type Context } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { LAYOUT } from "./config.js";
import { STATUSES, isExternalSource, summaryOf, type Fiche, type Status } from "./fiche.js";
import { renderMarkdown } from "./links.js";
import { lint } from "./lint.js";
import { search } from "./search.js";
import { Vault, type Actor } from "./vault.js";

const UI_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "ui");
const USER: Actor = { session: "user" };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

export interface ServeOptions {
  port: number;
  /** Listen on an inherited socket (launchd passes it as fd 0). */
  fd?: number;
  /** Stop after this many idle minutes. An open window polls, so it keeps the server alive. */
  idleMinutes?: number;
  quiet?: boolean;
}

function originOf(f: Fiche): "session" | "import" | "link" {
  if (f.fm.sources.some((s) => s.includes("/sessions/"))) return "session";
  if (f.fm.sources.some((s) => s.includes("/imports/"))) return "import";
  return "link";
}

function ficheRow(v: Vault, f: Fiche, reuses: Map<string, number>) {
  return {
    origin: originOf(f),
    title: f.fm.title,
    status: f.fm.status,
    tags: f.fm.tags,
    created: f.fm.created,
    updated: f.fm.updated,
    summary: summaryOf(f),
    reuses: reuses.get(f.fm.title) ?? 0,
    path: f.path,
  };
}

export function createApp(vault: Vault, port: number, onActivity: () => void = () => {}) {
  const app = new Hono();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

  // A page from another site must not read or change the wiki: check Host (DNS rebinding) and Origin (CSRF).
  app.use("*", async (c, next) => {
    onActivity();
    const host = c.req.header("host") ?? "";
    if (!allowedHosts.has(host)) return c.text("Forbidden host", 403);
    const origin = c.req.header("origin");
    if (origin && !allowedOrigins.has(origin)) return c.text("Forbidden origin", 403);
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      if (!origin) return c.text("Origin required", 403);
      if (!(c.req.header("content-type") ?? "").startsWith("application/json")) return c.text("JSON required", 415);
    }
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
  });

  app.get("/api/home", (c) => {
    const fiches = vault.fiches();
    const reuse = vault.reuse();
    const issues = lint(vault);
    const inbox = vault.inbox();
    const byUpdated = [...fiches].sort((a, b) => b.fm.updated.localeCompare(a.fm.updated) || b.mtimeMs - a.mtimeMs);
    const home = os.homedir();
    return c.json({
      wiki: vault.root.startsWith(home + path.sep) ? "~" + vault.root.slice(home.length) : vault.root,
      counts: {
        fiches: fiches.length,
        drafts: fiches.filter((f) => f.fm.status === "draft").length,
        validated: fiches.filter((f) => f.fm.status === "validated").length,
        inbox: inbox.filter((i) => i.supported).length,
        unsupported: inbox.filter((i) => !i.supported).length,
        reuses: reuse.total,
      },
      lint: {
        error: issues.filter((i) => i.severity === "error").length,
        warning: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
      },
      drafts: byUpdated.filter((f) => f.fm.status === "draft").slice(0, 20).map((f) => ficheRow(vault, f, reuse.byTitle)),
      recent: byUpdated.slice(0, 5).map((f) => ficheRow(vault, f, reuse.byTitle)),
      reused: reuse.recent.slice(0, 8),
      inbox: inbox.map((i) => ({ name: i.name, size: i.size, mtime: new Date(i.mtimeMs).toISOString(), supported: i.supported })),
    });
  });

  // Writes and reuses per day, for the activity chart.
  app.get("/api/activity", (c) => {
    const days = Math.min(90, Math.max(7, Number(c.req.query("days") ?? 14)));
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
    const rows = new Map(keys.map((k) => [k, { day: k, written: 0, validated: 0, reused: 0 }]));
    for (const e of vault.readLog()) {
      const r = rows.get(e.at.slice(0, 10));
      if (!r) continue;
      if (e.action === "create" || e.action === "update") r.written++;
      if (e.action === "validate") r.validated++;
    }
    for (const u of vault.reuse().recent) {
      const r = rows.get(u.at.slice(0, 10));
      if (r) r.reused++;
    }
    return c.json([...rows.values()]);
  });

  app.get("/api/fiches", (c) => {
    const reuse = vault.reuse();
    return c.json(vault.fiches().map((f) => ficheRow(vault, f, reuse.byTitle)));
  });

  app.get("/api/fiche", (c) => {
    const f = vault.resolve(c.req.query("title") ?? "");
    if (!f) return c.json({ error: "not found" }, 404);
    const resolve = (t: string) => vault.resolve(t)?.fm.title;
    const reuse = vault.reuse();
    return c.json({
      ...ficheRow(vault, f, reuse.byTitle),
      html: renderMarkdown(f.body, resolve),
      sources: f.fm.sources.map((s) => {
        if (isExternalSource(s)) return { ref: s, kind: "url", ok: true };
        const kind = s.includes("/sessions/") ? "session" : s.includes("/imports/") ? "import" : "file";
        return { ref: s, kind, ok: !vault.checkSource(s) };
      }),
      links: vault.linksOf(f).map((l) => ({ target: l.target, title: resolve(l.target) ?? null })),
      backlinks: vault.backlinks(f).map((b) => b.fm.title),
      history: vault.readLog().filter((e) => e.title === f.fm.title).reverse(),
      // The agent changed a fiche you had validated: say so in the review.
      revalidation: (() => {
        const h = vault.readLog().filter((e) => e.title === f.fm.title);
        const lastValidate = h.map((e) => e.action).lastIndexOf("validate");
        return f.fm.status === "draft" && lastValidate >= 0 && h.slice(lastValidate).some((e) => e.action === "update");
      })(),
    });
  });

  app.get("/api/source", (c) => {
    const rel = path.posix.normalize(c.req.query("path") ?? "");
    if (!rel.startsWith(LAYOUT.sources + "/") || rel.includes("..")) return c.json({ error: "not a source" }, 400);
    try {
      return c.json({ path: rel, content: fs.readFileSync(vault.abs(rel), "utf8") });
    } catch {
      return c.json({ error: "not found" }, 404);
    }
  });

  app.get("/api/search", (c) => {
    const q = (c.req.query("q") ?? "").trim();
    const tag = c.req.query("tag");
    const status = c.req.query("status");
    let fiches = vault.fiches();
    if (tag) fiches = fiches.filter((f) => f.fm.tags.includes(tag));
    if (status) fiches = fiches.filter((f) => f.fm.status === status);
    if (!q) {
      const reuse = vault.reuse();
      return c.json(
        fiches.map((f) => ({ ...ficheRow(vault, f, reuse.byTitle), score: 0, excerpt: summaryOf(f) })),
      );
    }
    const byTitle = new Map(fiches.map((f) => [f.fm.title, f]));
    return c.json(
      search(fiches, q, 100).map((h) => ({ ...h, updated: byTitle.get(h.title)?.fm.updated })),
    );
  });

  app.get("/api/tags", (c) => {
    const counts = new Map<string, number>();
    for (const f of vault.fiches()) for (const t of f.fm.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return c.json([...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)));
  });

  app.get("/api/graph", (c) => {
    const fiches = vault.fiches();
    const links: { source: string; target: string }[] = [];
    const degree = new Map<string, number>();
    const inbound = new Map<string, number>();
    for (const f of fiches)
      for (const l of vault.linksOf(f)) {
        const to = vault.resolve(l.target);
        if (!to || to.path === f.path) continue;
        if (links.some((x) => x.source === f.fm.title && x.target === to.fm.title)) continue;
        links.push({ source: f.fm.title, target: to.fm.title });
        degree.set(f.fm.title, (degree.get(f.fm.title) ?? 0) + 1);
        degree.set(to.fm.title, (degree.get(to.fm.title) ?? 0) + 1);
        inbound.set(to.fm.title, (inbound.get(to.fm.title) ?? 0) + 1);
      }
    // Islands: connected components, so the interface can show isolated groups.
    const parent = new Map(fiches.map((f) => [f.fm.title, f.fm.title]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const l of links) parent.set(find(l.source), find(l.target));
    const sizes = new Map<string, number>();
    for (const f of fiches) sizes.set(find(f.fm.title), (sizes.get(find(f.fm.title)) ?? 0) + 1);
    const largest = Math.max(0, ...sizes.values());
    return c.json({
      nodes: fiches.map((f) => ({
        id: f.fm.title,
        status: f.fm.status,
        tag: f.fm.tags[0],
        degree: degree.get(f.fm.title) ?? 0,
        orphan: fiches.length > 1 && !inbound.get(f.fm.title),
        island: sizes.get(find(f.fm.title))! < largest,
      })),
      links,
      islands: [...sizes.values()].filter((s) => s < largest).length,
    });
  });

  app.get("/api/lint", (c) => c.json(lint(vault)));

  app.get("/api/log", (c) => {
    const limit = Number(c.req.query("limit") ?? 100);
    return c.json(vault.readLog().reverse().slice(0, limit));
  });

  async function body<T>(c: Context): Promise<T | undefined> {
    try {
      return (await c.req.json()) as T;
    } catch {
      return undefined;
    }
  }

  app.post("/api/fiche/status", async (c) => {
    const b = await body<{ title: string; status: Status }>(c);
    if (!b || !STATUSES.includes(b.status)) return c.json({ ok: false, problems: [{ field: "status", message: "invalid status" }] }, 400);
    const r = vault.setStatus(b.title, b.status, USER);
    return c.json(r, r.ok ? 200 : 400);
  });

  app.post("/api/fiche/tags", async (c) => {
    const b = await body<{ title: string; tags: string[] }>(c);
    if (!b || !Array.isArray(b.tags)) return c.json({ ok: false, problems: [{ field: "tags", message: "invalid tags" }] }, 400);
    const r = vault.setTags(b.title, b.tags, USER);
    return c.json(r, r.ok ? 200 : 400);
  });

  app.post("/api/fiche/reject", async (c) => {
    const b = await body<{ title: string }>(c);
    if (!b) return c.json({ ok: false }, 400);
    const r = vault.reject(b.title, USER);
    return c.json(r, r.ok ? 200 : 400);
  });

  // The page polls this to refresh when the wiki changes on disk (the agent writes, you edit in Obsidian).
  app.get("/api/version", (c) => c.json({ version: vault.version() }));

  app.get("*", (c) => {
    let rel = decodeURIComponent(new URL(c.req.url).pathname);
    if (rel === "/" || !path.extname(rel)) rel = "/index.html";
    const file = path.join(UI_DIR, path.normalize(rel));
    if (!file.startsWith(UI_DIR + path.sep) || !fs.existsSync(file)) {
      if (rel === "/index.html") return c.text("Interface not built. Run `npm run build:ui`.", 500);
      return c.text("Not found", 404);
    }
    const ext = path.extname(file);
    c.header("Content-Type", MIME[ext] ?? "application/octet-stream");
    c.header("Cache-Control", rel.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
    return c.body(fs.readFileSync(file));
  });

  return app;
}

export function serve(vault: Vault, opts: ServeOptions): Promise<Server> {
  let last = Date.now();
  const app = createApp(vault, opts.port, () => (last = Date.now()));
  const server = createAdaptorServer({ fetch: app.fetch }) as Server;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    const ready = () => {
      if (!opts.quiet) {
        const { port } = server.address() as AddressInfo;
        console.log(`Stet is running at http://127.0.0.1:${port}`);
      }
      if (opts.idleMinutes) {
        const limit = opts.idleMinutes * 60_000;
        setInterval(() => {
          if (Date.now() - last > limit) process.exit(0);
        }, Math.min(limit, 30_000)).unref();
      }
      resolve(server);
    };
    if (opts.fd !== undefined) server.listen({ fd: opts.fd }, ready);
    else server.listen(opts.port, "127.0.0.1", ready);
  });
}
