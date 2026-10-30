import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/web.js";
import { Vault } from "../src/vault.js";

let vault: Vault;
let app: ReturnType<typeof createApp>;
const H = { host: "127.0.0.1:4747" };
const O = { ...H, origin: "http://127.0.0.1:4747", "content-type": "application/json" };

beforeEach(() => {
  vault = new Vault(fs.mkdtempSync(path.join(os.tmpdir(), "stet-web-")));
  vault.init();
  const agent = { session: "s-2026-10-30-aaaaaa" };
  vault.writeFiche({ title: "A", body: "Alpha.", sources: ["https://a.b"], tags: ["t"] }, agent);
  vault.writeFiche({ title: "B", body: "Links [[A]].", sources: ["https://a.b"], tags: ["t", "u"] }, agent);
  app = createApp(vault, 4747);
});

describe("local security", () => {
  it("refuses foreign hosts (DNS rebinding) and foreign origins", async () => {
    expect((await app.request("/api/home", { headers: { host: "evil.com:4747" } })).status).toBe(403);
    expect((await app.request("/api/home", { headers: { ...H, origin: "https://evil.com" } })).status).toBe(403);
    expect((await app.request("/api/home", { headers: H })).status).toBe(200);
  });

  it("requires a same-origin JSON request to change anything", async () => {
    const body = JSON.stringify({ title: "A", status: "validated" });
    expect((await app.request("/api/fiche/status", { method: "POST", headers: H, body })).status).toBe(403);
    expect(
      (await app.request("/api/fiche/status", { method: "POST", headers: { ...O, "content-type": "text/plain" }, body })).status,
    ).toBe(415);
    expect((await app.request("/api/fiche/status", { method: "POST", headers: O, body })).status).toBe(200);
    expect(vault.resolve("A")!.fm.status).toBe("validated");
  });
});

describe("API", () => {
  it("serves home, fiche, graph, search, tags and lint", async () => {
    const home = await (await app.request("/api/home", { headers: H })).json();
    expect(home.counts).toMatchObject({ fiches: 2, drafts: 2 });
    const a = await (await app.request("/api/fiche?title=a", { headers: H })).json();
    expect(a.backlinks).toEqual(["B"]);
    const b = await (await app.request("/api/fiche?title=B", { headers: H })).json();
    expect(b.html).toContain('href="#/fiche/A"');
    const g = await (await app.request("/api/graph", { headers: H })).json();
    expect(g.links).toEqual([{ source: "B", target: "A" }]);
    expect(g.nodes.find((n: { id: string }) => n.id === "B").orphan).toBe(true);
    const s = await (await app.request("/api/search?q=alpha", { headers: H })).json();
    expect(s[0].title).toBe("A");
    const tags = await (await app.request("/api/tags", { headers: H })).json();
    expect(tags[0]).toEqual({ tag: "t", count: 2 });
    expect(Array.isArray(await (await app.request("/api/lint", { headers: H })).json())).toBe(true);
  });

  it("changes tags and rejects fiches, never the body", async () => {
    await app.request("/api/fiche/tags", { method: "POST", headers: O, body: JSON.stringify({ title: "A", tags: ["x", "Y"] }) });
    expect(vault.resolve("A")!.fm.tags).toEqual(["x", "y"]);
    expect(vault.resolve("A")!.body.trim()).toBe("Alpha.");
    await app.request("/api/fiche/reject", { method: "POST", headers: O, body: JSON.stringify({ title: "A" }) });
    expect(vault.resolve("A")).toBeUndefined();
    expect(fs.readdirSync(vault.abs(".stet/rejected")).length).toBe(1);
  });

  it("serves sources only from sources/", async () => {
    expect((await app.request("/api/source?path=../etc/passwd", { headers: H })).status).toBe(400);
    expect((await app.request("/api/source?path=.stet/config.toml", { headers: H })).status).toBe(400);
  });
});
