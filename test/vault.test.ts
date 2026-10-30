import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseFiche, serializeFiche } from "../src/fiche.js";
import { extractLinks, renderMarkdown } from "../src/links.js";
import { lint } from "../src/lint.js";
import { search } from "../src/search.js";
import { Vault, type Actor } from "../src/vault.js";

let vault: Vault;
const agent: Actor = { session: "s-2026-10-30-aaaaaa" };
const user: Actor = { session: "user" };

function note(): string {
  const r = vault.writeSessionNote({ title: "Search choice", content: "We chose minisearch because it is small." }, agent);
  if (!r.ok) throw new Error("note refused");
  return r.path;
}

beforeEach(() => {
  vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "stet-")));
  vault.init();
});

describe("init", () => {
  it("creates the layout and is idempotent", () => {
    for (const p of ["inbox", "sources/imports", "sources/sessions", "fiches", "index.md", "log.md", "AGENTS.md", ".stet/config.toml"])
      expect(fs.existsSync(vault.abs(p)), p).toBe(true);
    expect(vault.init()).toEqual([]);
  });
});

describe("write_fiche validation", () => {
  it("accepts a valid fiche as a draft and updates the index and log", () => {
    const src = note();
    const r = vault.writeFiche({ title: "Search engine", body: "We use minisearch.", sources: [src], tags: ["Stet"] }, agent);
    expect(r.ok).toBe(true);
    const f = vault.resolve("search engine")!;
    expect(f.fm.status).toBe("draft");
    expect(f.fm.tags).toEqual(["stet"]);
    expect(f.fm.session).toBe(agent.session);
    expect(fs.readFileSync(vault.abs("index.md"), "utf8")).toContain("[[Search engine]] (draft)");
    expect(vault.readLog().at(-1)).toMatchObject({ action: "create", title: "Search engine" });
  });

  it("refuses missing sources, tags and unknown links with actionable messages", () => {
    const r = vault.writeFiche({ title: "X", body: "See [[Nowhere]].", sources: [], tags: [] }, agent);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msgs = r.problems.map((p) => p.message).join("\n");
    expect(msgs).toContain("at least one source");
    expect(msgs).toContain("at least one tag");
    expect(msgs).toContain("[[Nowhere]]");
  });

  it("refuses sources that do not exist, live outside sources/, or are fiches", () => {
    const r = vault.writeFiche(
      { title: "X", body: "b", sources: ["sources/nope.md", "../etc/passwd", "README.md", "fiches/A.md"], tags: ["t"] },
      agent,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(4);
  });

  it("accepts URLs as sources", () => {
    const r = vault.writeFiche({ title: "X", body: "b", sources: ["https://example.com/a"], tags: ["t"] }, agent);
    expect(r.ok).toBe(true);
  });

  it("refuses a duplicate title unless update is set, and near-duplicates", () => {
    const src = note();
    vault.writeFiche({ title: "Search engine", body: "v1", sources: [src], tags: ["t"] }, agent);
    expect(vault.writeFiche({ title: "search engine", body: "v2", sources: [src], tags: ["t"] }, agent).ok).toBe(false);
    expect(vault.writeFiche({ title: "Search-engine!", body: "v2", sources: [src], tags: ["t"] }, agent).ok).toBe(false);
    expect(vault.writeFiche({ title: "Other", body: "v2", sources: [src], tags: ["t"], update: true }, agent).ok).toBe(false);
    const up = vault.writeFiche({ title: "Search engine", body: "v2", sources: [src], tags: ["t"], update: true }, agent);
    expect(up.ok).toBe(true);
    expect(vault.resolve("Search engine")!.body.trim()).toBe("v2");
  });

  it("refuses a body that carries frontmatter", () => {
    const r = vault.writeFiche({ title: "X", body: "---\ntitle: X\n---\nhi", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(r.ok).toBe(false);
  });

  it("sends a validated fiche back to draft when the agent updates it", () => {
    vault.writeFiche({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(vault.setStatus("A", "validated", agent).ok).toBe(false);
    expect(vault.setStatus("A", "validated", user).ok).toBe(true);
    const r = vault.writeFiche({ title: "A", body: "a2", sources: ["https://a.b"], tags: ["t"], update: true }, agent);
    expect(r.ok && r.notes[0]).toContain("back to draft");
    expect(vault.resolve("A")!.fm.status).toBe("draft");
  });

  it("refuses writes from an excluded folder", () => {
    fs.writeFileSync(vault.abs(".stet/config.toml"), 'excluded = ["/work/client"]\n');
    const v = new Vault(vault.root);
    const r = v.writeFiche({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, { ...agent, cwd: "/work/client/repo" });
    expect(r.ok).toBe(false);
    expect(v.writeFiche({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, { ...agent, cwd: "/work/other" }).ok).toBe(true);
  });
});

describe("inbox", () => {
  it("lists items, flags unsupported formats, and moves cited items to sources/imports", () => {
    fs.writeFileSync(vault.abs("inbox/meeting.txt"), "Decision: ship on Friday.");
    fs.writeFileSync(vault.abs("inbox/slides.pdf"), "%PDF");
    expect(vault.inbox().map((i) => [i.name, i.supported])).toEqual(
      expect.arrayContaining([["meeting.txt", true], ["slides.pdf", false]]),
    );
    const r = vault.writeFiche({ title: "Ship date", body: "Friday.", sources: ["inbox/meeting.txt"], tags: ["t"] }, agent);
    expect(r.ok).toBe(true);
    expect(vault.resolve("Ship date")!.fm.sources).toEqual(["sources/imports/meeting.txt"]);
    expect(fs.existsSync(vault.abs("inbox/meeting.txt"))).toBe(false);
    // A second fiche can still cite the inbox path; it resolves to the import.
    const r2 = vault.writeFiche({ title: "Friday", body: "x", sources: ["inbox/meeting.txt"], tags: ["t"] }, agent);
    expect(r2.ok).toBe(true);
    expect(vault.completeItem("meeting.txt", ["Ship date", "Friday"], agent).ok).toBe(true);
    expect(vault.readLog().at(-1)!.detail).toContain("[[Ship date]]");
  });
});

describe("session notes", () => {
  it("are immutable and never overwritten", () => {
    const a = note();
    const b = note();
    expect(a).not.toBe(b);
    expect(() => fs.writeFileSync(vault.abs(a), "x")).toThrow();
    expect(fs.readFileSync(vault.abs(a), "utf8")).toContain("written_by: agent");
  });
});

describe("links", () => {
  it("ignores links in code and handles aliases and headings", () => {
    const links = extractLinks("See [[A|the a]] and [[B#part]].\n\n`[[C]]`\n\n```\n[[D]]\n```");
    expect(links.map((l) => l.target)).toEqual(["A", "B"]);
    expect(links[0].alias).toBe("the a");
  });

  it("renders links and marks broken ones, without raw HTML", () => {
    const html = renderMarkdown("[[A]] [[Z]] <script>x</script>", (t) => (t === "A" ? "A" : undefined));
    expect(html).toContain('href="#/wiki/A"');
    expect(html).toContain("broken");
    expect(html).not.toContain("<script>");
  });
});

describe("frontmatter", () => {
  it("round-trips and keeps unknown fields", () => {
    const text = serializeFiche(
      { title: "A: b", status: "draft", sources: ["https://x.y/z?q=1"], tags: ["t"], created: "2026-10-30", updated: "2026-10-30" },
      "Body",
      { aliases: ["AB"] },
    );
    const p = parseFiche(text, "fiches/A.md");
    expect(p.problems).toEqual([]);
    expect(p.fiche!.fm.title).toBe("A: b");
    expect(p.fiche!.extra).toEqual({ aliases: ["AB"] });
  });
});

describe("lint", () => {
  it("reports broken links, orphans, missing sources, invalid files, index drift and stale items", () => {
    vault.writeFiche({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    vault.writeFiche({ title: "B", body: "links [[A]]", sources: ["https://a.b"], tags: ["t"] }, agent);
    fs.writeFileSync(vault.abs("fiches/Hand.md"), "---\ntitle: Hand\n---\nno status");
    fs.appendFileSync(vault.abs("fiches/B.md"), "\nand [[Gone]]\n");
    fs.writeFileSync(vault.abs("inbox/old.md"), "old");
    const old = (Date.now() - 10 * 86_400_000) / 1000;
    fs.utimesSync(vault.abs("inbox/old.md"), old, old);
    const codes = lint(vault).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["broken_link", "orphan", "invalid_fiche", "stale_inbox"]));
    expect(lint(vault, Date.now() + 30 * 86_400_000).map((i) => i.code)).toContain("stale_draft");
    fs.writeFileSync(vault.abs("index.md"), "edited");
    expect(lint(vault).map((i) => i.code)).toContain("index_out_of_sync");
  });
});

describe("search and reuse", () => {
  it("finds fiches by word, accent-insensitive", () => {
    vault.writeFiche({ title: "Décision moteur", body: "On garde minisearch pour la recherche.", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(search(vault.fiches(), "decision")[0].title).toBe("Décision moteur");
    expect(search(vault.fiches(), "minisearch")[0].excerpt).toContain("minisearch");
  });

  it("counts a reuse only for reads from another session, once per session", () => {
    vault.writeFiche({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    vault.recordRead("A", agent.session);
    vault.recordRead("A", "s-2026-11-02-bbbbbb");
    vault.recordRead("A", "s-2026-11-02-bbbbbb");
    vault.recordRead("A", "user");
    expect(vault.reuse().total).toBe(1);
  });
});
