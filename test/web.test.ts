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
  vault.writeCard({ title: "A", body: "Alpha.", sources: ["https://a.b"], tags: ["t"] }, agent);
  vault.writeCard({ title: "B", body: "Links [[A]].", sources: ["https://a.b"], tags: ["t", "u"] }, agent);
  app = createApp(vault, 4747);
});

describe("routes", () => {
  it("answers an unknown API route with a JSON 404, not the page", async () => {
    const r = await app.request("/api/nothing-here", { headers: H });
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("reports a build stamp so an open page reloads after an update", async () => {
    const v = await (await app.request("/api/version", { headers: H })).json();
    expect(Number(v.build)).toBeGreaterThan(0);
  });
});

describe("local security", () => {
  it("refuses foreign hosts (DNS rebinding) and foreign origins", async () => {
    expect((await app.request("/api/home", { headers: { host: "evil.com:4747" } })).status).toBe(403);
    expect((await app.request("/api/home", { headers: { ...H, origin: "https://evil.com" } })).status).toBe(403);
    expect((await app.request("/api/home", { headers: H })).status).toBe(200);
  });

  it("requires a same-origin JSON request to change anything", async () => {
    const body = JSON.stringify({ title: "A", status: "validated" });
    expect((await app.request("/api/card/status", { method: "POST", headers: H, body })).status).toBe(403);
    expect(
      (await app.request("/api/card/status", { method: "POST", headers: { ...O, "content-type": "text/plain" }, body })).status,
    ).toBe(415);
    expect((await app.request("/api/card/status", { method: "POST", headers: O, body })).status).toBe(200);
    expect(vault.resolve("A")!.fm.status).toBe("validated");
  });
});

describe("API", () => {
  it("serves home, card, graph, search, tags and lint", async () => {
    const home = await (await app.request("/api/home", { headers: H })).json();
    expect(home.counts).toMatchObject({ cards: 2, drafts: 2 });
    const a = await (await app.request("/api/card?title=a", { headers: H })).json();
    expect(a.backlinks).toEqual(["B"]);
    const b = await (await app.request("/api/card?title=B", { headers: H })).json();
    expect(b.html).toContain('href="#/wiki/A"');
    const g = await (await app.request("/api/graph", { headers: H })).json();
    expect(g.links).toEqual([{ source: "B", target: "A" }]);
    expect(g.nodes.find((n: { id: string }) => n.id === "B").orphan).toBe(true);
    const s = await (await app.request("/api/search?q=alpha", { headers: H })).json();
    expect(s[0].title).toBe("A");
    const tags = await (await app.request("/api/tags", { headers: H })).json();
    expect(tags[0]).toEqual({ tag: "t", count: 2 });
    expect(Array.isArray(await (await app.request("/api/lint", { headers: H })).json())).toBe(true);
  });

  it("changes tags and rejects cards, never the body", async () => {
    await app.request("/api/card/tags", { method: "POST", headers: O, body: JSON.stringify({ title: "A", tags: ["x", "Y"] }) });
    expect(vault.resolve("A")!.fm.tags).toEqual(["x", "y"]);
    expect(vault.resolve("A")!.body.trim()).toBe("Alpha.");
    await app.request("/api/card/reject", { method: "POST", headers: O, body: JSON.stringify({ title: "A" }) });
    expect(vault.resolve("A")).toBeUndefined();
    expect(fs.readdirSync(vault.abs(".stet/rejected")).length).toBe(1);
  });

  it("serves sources only from sources/", async () => {
    expect((await app.request("/api/source?path=../etc/passwd", { headers: H })).status).toBe(400);
    expect((await app.request("/api/source?path=.stet/config.toml", { headers: H })).status).toBe(400);
  });
});

describe("setup", () => {
  it("reports each first-run step from the files", async () => {
    let s = await (await app.request("/api/setup", { headers: H })).json();
    expect(s).toMatchObject({ agent: null, cards: 2, validated: 0 });
    vault.recordAgentSession("s-2026-10-30-cccccc", "/home/me/project");
    vault.setStatus("A", "validated", { session: "user" });
    s = await (await app.request("/api/setup", { headers: H })).json();
    expect(s.agent.sessions).toBe(1);
    expect(s.agent.last_folder).toBe("project");
    expect(s.validated).toBe(1);
  });

  it("opens only fixed folders", async () => {
    const r = await app.request("/api/reveal", { method: "POST", headers: O, body: JSON.stringify({ what: "/etc" }) });
    expect(r.status).toBe(400);
  });
});
