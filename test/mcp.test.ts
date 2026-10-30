import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CLI = path.resolve(__dirname, "../dist/cli.js");
let home: string;
let client: Client;

type ToolResult = { content: { type: string; text: string }[]; isError?: boolean };
async function call(name: string, args: Record<string, unknown> = {}) {
  const r = (await client.callTool({ name, arguments: args })) as ToolResult;
  const text = r.content[0]?.text ?? "";
  let data: any = text;
  try {
    data = JSON.parse(text);
  } catch {
    // refusals are plain text
  }
  return { data, text, isError: !!r.isError };
}

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "stet-mcp-"));
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, [CLI, "init"], { env: { ...process.env, STET_HOME: home } });
  fs.writeFileSync(path.join(home, "inbox", "standup.md"), "# Standup\n\nWe moved the release to Friday because QA needs two more days.");
  client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [CLI, "mcp"], env: { ...process.env, STET_HOME: home } as Record<string, string> }),
  );
});

afterAll(async () => {
  await client?.close();
});

describe("MCP server", () => {
  it("exposes the ten tools and instructions", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["complete_item", "index", "lint", "log", "queue_next", "read", "search", "status", "write_fiche", "write_session_note"].sort(),
    );
    expect(client.getInstructions()).toContain("propose once per session");
  });

  it("runs the inbox flow end to end", async () => {
    const st = await call("status");
    expect(st.data.inbox_waiting).toBe(1);
    expect(st.data.capture_allowed).toBe(true);

    const q = await call("queue_next");
    expect(q.data.item).toBe("standup.md");
    expect(q.data.chunk).toContain("Friday");

    const refused = await call("write_fiche", { title: "Release date", body: "Friday.", sources: [], tags: [] });
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("at least one source");

    const ok = await call("write_fiche", {
      title: "Release date",
      body: "The release moved to Friday: QA needs two more days.",
      sources: [q.data.cite_as],
      tags: ["release"],
    });
    expect(ok.isError).toBe(false);
    expect((await call("complete_item", { item: "standup.md", fiches: ["Release date"] })).isError).toBe(false);
    expect((await call("queue_next")).data.empty).toBe(true);
  });

  it("runs the session capture flow end to end", async () => {
    const n = await call("write_session_note", {
      title: "QA staffing",
      content: "Decided to add a second QA reviewer for releases.",
      artefacts: ["https://example.com/ticket/42"],
    });
    expect(n.data.path).toMatch(/^sources\/sessions\//);
    const w = await call("write_fiche", {
      title: "QA reviewers",
      body: "Two QA reviewers per release. Context: [[Release date]].",
      sources: [n.data.path, "https://example.com/ticket/42"],
      tags: ["release", "qa"],
    });
    expect(w.isError).toBe(false);
    const s = await call("search", { query: "reviewers" });
    expect(s.data[0].title).toBe("QA reviewers");
    const r = await call("read", { title: "Release date" });
    expect(r.data.links_here).toEqual(["QA reviewers"]);
    const idx = await call("index", { limit: 1 });
    expect(idx.data.total).toBe(2);
    expect(idx.data.next_offset).toBe(1);
    const agents = await call("read", { path: "AGENTS.md" });
    expect(agents.data.chunk).toContain("How to maintain this wiki".replace("How", "how"));
    expect((await call("read", { path: "../etc/passwd" })).isError).toBe(true);
  });

  it("lints and logs", async () => {
    const l = await call("lint");
    expect(l.data.issues.map((i: { code: string }) => i.code)).not.toContain("broken_link");
    expect((await call("log", { message: "deep check: no contradictions" })).isError).toBe(false);
    expect(fs.readFileSync(path.join(home, "log.md"), "utf8")).toContain("deep check");
  });
});
