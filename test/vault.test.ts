import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { parseCard, serializeCard } from "../src/card.js";
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

describe("migration", () => {
  it("moves a wiki's old fiches/ folder to cards/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "stet-old-"));
    new Vault(root).init();
    fs.renameSync(path.join(root, "cards"), path.join(root, "fiches"));
    fs.writeFileSync(path.join(root, "fiches", "Old.md"), serializeCard({ title: "Old", status: "draft", sources: ["https://a.b"], tags: ["t"], created: "2026-10-30", updated: "2026-10-30" }, "Body."));
    const v = new Vault(root);
    expect(v.isInitialized()).toBe(true);
    expect(v.resolve("Old")?.path).toBe("cards/Old.md");
    expect(fs.existsSync(path.join(root, "fiches"))).toBe(false);
  });
});

describe("init", () => {
  it("creates the layout and is idempotent", () => {
    for (const p of ["inbox", "sources/imports", "sources/sessions", "cards", "index.md", "log.md", "AGENTS.md", ".stet/config.toml"])
      expect(fs.existsSync(vault.abs(p)), p).toBe(true);
    expect(vault.init()).toEqual([]);
  });
});

describe("write_card validation", () => {
  it("accepts a valid card as a draft and updates the index and log", () => {
    const src = note();
    const r = vault.writeCard({ title: "Search engine", body: "We use minisearch.", sources: [src], tags: ["Stet"] }, agent);
    expect(r.ok).toBe(true);
    const f = vault.resolve("search engine")!;
    expect(f.fm.status).toBe("draft");
    expect(f.fm.tags).toEqual(["stet"]);
    expect(f.fm.session).toBe(agent.session);
    expect(fs.readFileSync(vault.abs("index.md"), "utf8")).toContain("[[Search engine]] (draft)");
    expect(vault.readLog().at(-1)).toMatchObject({ action: "create", title: "Search engine" });
  });

  it("refuses missing sources, tags and unknown links with actionable messages", () => {
    const r = vault.writeCard({ title: "X", body: "See [[Nowhere]].", sources: [], tags: [] }, agent);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const msgs = r.problems.map((p) => p.message).join("\n");
    expect(msgs).toContain("at least one source");
    expect(msgs).toContain("at least one tag");
    expect(msgs).toContain("[[Nowhere]]");
  });

  it("refuses sources that do not exist, live outside sources/, or are cards", () => {
    const r = vault.writeCard(
      { title: "X", body: "b", sources: ["sources/nope.md", "../etc/passwd", "README.md", "cards/A.md"], tags: ["t"] },
      agent,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toHaveLength(4);
  });

  it("accepts URLs as sources", () => {
    const r = vault.writeCard({ title: "X", body: "b", sources: ["https://example.com/a"], tags: ["t"] }, agent);
    expect(r.ok).toBe(true);
  });

  it("refuses a duplicate title unless update is set, and near-duplicates", () => {
    const src = note();
    vault.writeCard({ title: "Search engine", body: "v1", sources: [src], tags: ["t"] }, agent);
    expect(vault.writeCard({ title: "search engine", body: "v2", sources: [src], tags: ["t"] }, agent).ok).toBe(false);
    expect(vault.writeCard({ title: "Search-engine!", body: "v2", sources: [src], tags: ["t"] }, agent).ok).toBe(false);
    expect(vault.writeCard({ title: "Other", body: "v2", sources: [src], tags: ["t"], update: true }, agent).ok).toBe(false);
    const up = vault.writeCard({ title: "Search engine", body: "v2", sources: [src], tags: ["t"], update: true }, agent);
    expect(up.ok).toBe(true);
    expect(vault.resolve("Search engine")!.body.trim()).toBe("v2");
  });

  it("refuses a body that carries frontmatter", () => {
    const r = vault.writeCard({ title: "X", body: "---\ntitle: X\n---\nhi", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(r.ok).toBe(false);
  });

  it("sends a validated card back to draft when the agent updates it", () => {
    vault.writeCard({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(vault.setStatus("A", "validated", agent).ok).toBe(false);
    expect(vault.setStatus("A", "validated", user).ok).toBe(true);
    const r = vault.writeCard({ title: "A", body: "a2", sources: ["https://a.b"], tags: ["t"], update: true }, agent);
    expect(r.ok && r.notes[0]).toContain("back to draft");
    expect(vault.resolve("A")!.fm.status).toBe("draft");
  });

  it("refuses writes from an excluded folder", () => {
    fs.writeFileSync(vault.abs(".stet/config.toml"), 'excluded = ["/work/client"]\n');
    const v = new Vault(vault.root);
    const r = v.writeCard({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, { ...agent, cwd: "/work/client/repo" });
    expect(r.ok).toBe(false);
    expect(v.writeCard({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, { ...agent, cwd: "/work/other" }).ok).toBe(true);
  });
});

describe("inbox", () => {
  it("lists items, flags unsupported formats, and moves cited items to sources/imports", () => {
    fs.writeFileSync(vault.abs("inbox/meeting.txt"), "Decision: ship on Friday.");
    fs.writeFileSync(vault.abs("inbox/slides.pdf"), "%PDF");
    expect(vault.inbox().map((i) => [i.name, i.supported])).toEqual(
      expect.arrayContaining([["meeting.txt", true], ["slides.pdf", false]]),
    );
    const r = vault.writeCard({ title: "Ship date", body: "Friday.", sources: ["inbox/meeting.txt"], tags: ["t"] }, agent);
    expect(r.ok).toBe(true);
    expect(vault.resolve("Ship date")!.fm.sources).toEqual(["sources/imports/meeting.txt"]);
    expect(fs.existsSync(vault.abs("inbox/meeting.txt"))).toBe(false);
    // A second card can still cite the inbox path; it resolves to the import.
    const r2 = vault.writeCard({ title: "Friday", body: "x", sources: ["inbox/meeting.txt"], tags: ["t"] }, agent);
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
    const text = serializeCard(
      { title: "A: b", status: "draft", sources: ["https://x.y/z?q=1"], tags: ["t"], created: "2026-10-30", updated: "2026-10-30" },
      "Body",
      { aliases: ["AB"] },
    );
    const p = parseCard(text, "cards/A.md");
    expect(p.problems).toEqual([]);
    expect(p.card!.fm.title).toBe("A: b");
    expect(p.card!.extra).toEqual({ aliases: ["AB"] });
  });
});

describe("kind and project", () => {
  const src = "https://example.com/a";
  const inShop: Actor = { session: "s-2026-11-02-bbbbbb", cwd: "/Users/me/dev/shop-api" };
  it("takes the current folder as a new project, refuses an unknown one, keeps both on update", () => {
    expect(vault.writeCard({ title: "Pool", body: "b", sources: [src], tags: ["db"], kind: "decision", project: "shop-api" }, inShop).ok).toBe(true);
    expect(vault.projects()).toEqual(["shop-api"]);
    const r = vault.writeCard({ title: "Other", body: "b", sources: [src], tags: ["db"], project: "made-up" }, inShop);
    expect(r.ok).toBe(false);
    expect(r.problems?.[0].message).toContain("unknown project");
    expect(vault.writeCard({ title: "Bad kind", body: "b", sources: [src], tags: ["db"], kind: "idea" }, inShop).ok).toBe(false);
    vault.writeCard({ title: "Pool", body: "b2", sources: [src], tags: ["db"], update: true }, inShop);
    expect(vault.resolve("Pool")?.fm).toMatchObject({ kind: "decision", project: "shop-api" });
  });

  it("lets the user add a project and change a card's kind and project, keeping its status", () => {
    vault.writeCard({ title: "Pool", body: "b", sources: [src], tags: ["db"] }, agent);
    vault.setStatus("Pool", "validated", user);
    expect(vault.setMeta("Pool", { project: "billing" }, user).ok).toBe(false);
    expect(vault.addProject("billing", user).ok).toBe(true);
    expect(vault.addProject("Billing", user).ok).toBe(false);
    expect(vault.setMeta("Pool", { project: "BILLING", kind: "fact" }, user).ok).toBe(true);
    expect(vault.resolve("Pool")?.fm).toMatchObject({ project: "billing", kind: "fact", status: "validated" });
    expect(vault.setMeta("Pool", { kind: null }, user).ok).toBe(true);
    expect(vault.resolve("Pool")?.fm.kind).toBeUndefined();
  });
});

describe("interface writes", () => {
  const src = "https://example.com/a";
  it("adds text files to the inbox without overwriting, and refuses other formats", () => {
    expect(vault.addToInbox("notes.md", "# Meeting", user).path).toBe("inbox/notes.md");
    expect(vault.addToInbox("notes.md", "# Again", user).path).toBe("inbox/notes 2.md");
    expect(vault.addToInbox("../../evil.md", "x", user).path).toBe("inbox/evil.md");
    expect(vault.addToInbox("slides.pdf", "x", user).ok).toBe(false);
    expect(vault.addToInbox("empty.txt", "  ", user).ok).toBe(false);
  });

  it("shows what an inbox file became, and takes a waiting file out without deleting it", () => {
    vault.addToInbox("call.md", "# Call", user);
    vault.addToInbox("typo.md", "oops", user);
    expect(vault.readInbox("call.md")).toBe("# Call");
    expect(vault.readInbox("../AGENTS.md")).toBeUndefined();
    vault.writeCard({ title: "From the call", body: "b", sources: ["inbox/call.md"], tags: ["t"] }, agent);
    vault.completeItem("call.md", ["From the call"], agent);
    expect(vault.processedInbox()[0]).toMatchObject({ name: "call.md", cards: ["From the call"], validated: 0 });
    expect(vault.removeFromInbox("typo.md", user).ok).toBe(true);
    expect(vault.inbox()).toHaveLength(0);
    expect(fs.readdirSync(path.join(vault.root, ".stet", "removed"))[0]).toMatch(/typo\.md$/);
  });

  it("lets the user edit a card's text, keeping its status and checking links", () => {
    vault.writeCard({ title: "Pool", body: "Size 10.", sources: [src], tags: ["db"] }, agent);
    vault.setStatus("Pool", "validated", user);
    const base = vault.resolve("Pool")!.body;
    expect(vault.editBody("Pool", "Size 12. See [[Nowhere]].", base, user).ok).toBe(false);
    expect(vault.editBody("Pool", "Size 12.", base, user).ok).toBe(true);
    const f = vault.resolve("Pool")!;
    expect(f.body.trim()).toBe("Size 12.");
    expect(f.fm.status).toBe("validated");
    // Saving over a newer version is refused.
    expect(vault.editBody("Pool", "Size 14.", base, user).ok).toBe(false);
    expect(vault.editBody("Pool", "Size 14.", f.body, agent).ok).toBe(false);
  });

  it("keeps the project and the query of a recall", () => {
    vault.writeCard({ title: "Pool", body: "Size 10.", sources: [src], tags: ["db"] }, agent);
    vault.recordRead("Pool", "s-later", "search", { project: "shop-api", query: "pool size" });
    vault.recordRead("Pool", "s-later", "read", { project: "shop-api" });
    const r = vault.reuse();
    expect(r.total).toBe(1);
    expect(r.byCard.get("Pool")?.[0]).toMatchObject({ project: "shop-api", query: "pool size" });
  });
});

describe("rejected cards", () => {
  const src = "https://example.com/a";
  it("lists and restores a rejected card as a draft", () => {
    vault.writeCard({ title: "Old idea", body: "b", sources: [src], tags: ["t"] }, agent);
    vault.reject("Old idea", user);
    const [r] = vault.listRejected();
    expect(r.title).toBe("Old idea");
    expect(r.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(vault.restore(r.file, user).ok).toBe(true);
    expect(vault.resolve("Old idea")?.fm.status).toBe("draft");
    expect(vault.listRejected()).toHaveLength(0);
  });

  it("refuses paths outside the rejected folder and title clashes", () => {
    expect(vault.restore("../cards/x.md", user).ok).toBe(false);
    vault.writeCard({ title: "Twin", body: "b", sources: [src], tags: ["t"] }, agent);
    vault.reject("Twin", user);
    vault.writeCard({ title: "Twin", body: "new", sources: [src], tags: ["t"] }, agent);
    expect(vault.restore(vault.listRejected()[0].file, user).ok).toBe(false);
  });
});

describe("validated snapshot", () => {
  it("keeps the validated text when the agent changes a card, until it is validated again", () => {
    const src = "https://example.com/a";
    vault.writeCard({ title: "Pool", body: "Size 10.", sources: [src], tags: ["db"] }, agent);
    vault.setStatus("Pool", "validated", user);
    vault.writeCard({ title: "Pool", body: "Size 20.", sources: [src], tags: ["db"], update: true }, agent);
    let f = vault.resolve("Pool")!;
    expect(vault.previousValidated(f)?.body.trim()).toBe("Size 10.");
    // A second change still compares with what the user validated.
    vault.writeCard({ title: "Pool", body: "Size 30.", sources: [src], tags: ["db"], update: true }, agent);
    f = vault.resolve("Pool")!;
    expect(vault.previousValidated(f)?.body.trim()).toBe("Size 10.");
    vault.setStatus("Pool", "validated", user);
    expect(vault.previousValidated(vault.resolve("Pool")!)).toBeUndefined();
  });
});

describe("lint", () => {
  it("names a link to a rejected card", () => {
    const src = "https://example.com/a";
    vault.writeCard({ title: "Old idea", body: "b", sources: [src], tags: ["t"] }, agent);
    vault.writeCard({ title: "Plan", body: "See [[Old idea]].", sources: [src], tags: ["t"] }, agent);
    expect(vault.reject("Old idea", user).ok).toBe(true);
    const broken = lint(vault).filter((i) => i.code === "broken_link");
    expect(broken).toHaveLength(1);
    expect(broken[0].message).toContain("you rejected");
  });

  it("reports broken links, orphans, missing sources, invalid files, index drift and stale items", () => {
    vault.writeCard({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    vault.writeCard({ title: "B", body: "links [[A]]", sources: ["https://a.b"], tags: ["t"] }, agent);
    fs.writeFileSync(vault.abs("cards/Hand.md"), "---\ntitle: Hand\n---\nno status");
    fs.appendFileSync(vault.abs("cards/B.md"), "\nand [[Gone]]\n");
    fs.writeFileSync(vault.abs("inbox/old.md"), "old");
    const old = (Date.now() - 10 * 86_400_000) / 1000;
    fs.utimesSync(vault.abs("inbox/old.md"), old, old);
    const codes = lint(vault).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["broken_link", "orphan", "invalid_card", "stale_inbox"]));
    expect(lint(vault, Date.now() + 30 * 86_400_000).map((i) => i.code)).toContain("stale_draft");
    fs.writeFileSync(vault.abs("index.md"), "edited");
    expect(lint(vault).map((i) => i.code)).toContain("index_out_of_sync");
  });
});

describe("search and reuse", () => {
  it("finds cards by word, accent-insensitive", () => {
    vault.writeCard({ title: "Décision moteur", body: "On garde minisearch pour la recherche.", sources: ["https://a.b"], tags: ["t"] }, agent);
    expect(search(vault.cards(), "decision")[0].title).toBe("Décision moteur");
    expect(search(vault.cards(), "minisearch")[0].excerpt).toContain("minisearch");
  });

  it("counts a reuse only for reads from another session, once per session", () => {
    vault.writeCard({ title: "A", body: "a", sources: ["https://a.b"], tags: ["t"] }, agent);
    vault.recordRead("A", agent.session);
    vault.recordRead("A", "s-2026-11-02-bbbbbb");
    vault.recordRead("A", "s-2026-11-02-bbbbbb");
    vault.recordRead("A", "user");
    expect(vault.reuse().total).toBe(1);
  });
});
