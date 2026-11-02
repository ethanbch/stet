import MiniSearch from "minisearch";
import { summaryOf, type Card } from "./card.js";

export interface Hit {
  title: string;
  status: string;
  tags: string[];
  summary: string;
  score: number;
  excerpt: string;
}

const strip = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function excerpt(body: string, terms: string[]): string {
  const flat = body
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/(\*\*|__|`|^#+\s|\|)/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
  const low = strip(flat);
  const pos = terms.map((t) => low.indexOf(strip(t))).filter((p) => p >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, pos - 60);
  return (start > 0 ? "..." : "") + flat.slice(start, start + 180) + (start + 180 < flat.length ? "..." : "");
}

/** Full-text search, rebuilt from the cards on each call: cheap at wiki scale. */
export function search(cards: Card[], query: string, limit = 10): Hit[] {
  const ms = new MiniSearch<{ id: number; title: string; tags: string; body: string }>({
    fields: ["title", "tags", "body"],
    processTerm: (t) => strip(t),
    searchOptions: { boost: { title: 3, tags: 2 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  });
  ms.addAll(cards.map((f, id) => ({ id, title: f.fm.title, tags: f.fm.tags.join(" "), body: f.body })));
  let results = ms.search(query);
  if (!results.length) results = ms.search(query, { combineWith: "OR" });
  return results.slice(0, limit).map((r) => {
    const f = cards[r.id as number];
    return {
      title: f.fm.title,
      status: f.fm.status,
      tags: f.fm.tags,
      summary: summaryOf(f),
      score: Math.round(r.score * 100) / 100,
      excerpt: excerpt(f.body, r.terms),
    };
  });
}
