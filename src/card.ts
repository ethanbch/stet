import matter from "gray-matter";
import { z } from "zod";

export const STATUSES = ["draft", "validated"] as const;
export type Status = (typeof STATUSES)[number];

/** What a card holds. The agent picks one when it writes; the user can change it. */
export const KINDS = ["decision", "fix", "fact", "how-to", "reference"] as const;
export type Kind = (typeof KINDS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** gray-matter turns `2026-10-30` into a Date; bring it back to a plain day. */
const day = z.preprocess(
  (v) => (v instanceof Date && !Number.isNaN(v.getTime()) ? v.toISOString().slice(0, 10) : v),
  z.string().regex(DATE_RE, "expected a date as YYYY-MM-DD"),
);

const nonEmpty = z.string().trim().min(1);

export const FrontmatterSchema = z.object({
  title: nonEmpty.max(120),
  status: z.enum(STATUSES, { message: `status must be one of: ${STATUSES.join(", ")}` }),
  sources: z.array(nonEmpty, { message: "sources must be a list" }).min(1, "at least one source is required"),
  tags: z.array(nonEmpty, { message: "tags must be a list" }).min(1, "at least one tag is required"),
  kind: z.enum(KINDS, { message: `kind must be one of: ${KINDS.join(", ")}` }).optional(),
  /** The project the card belongs to: one of the wiki's projects (`.stet/projects.json`). */
  project: nonEmpty.max(60).optional(),
  created: day,
  updated: day,
  session: z.string().optional(),
  summary: z.string().max(300).optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;

export interface Problem {
  field: string;
  message: string;
}

export interface Card {
  /** Path relative to the vault root, e.g. `cards/Search engine.md`. */
  path: string;
  fm: Frontmatter;
  body: string;
  /** Frontmatter keys Stet does not know, kept as written (Obsidian aliases, etc.). */
  extra: Record<string, unknown>;
  mtimeMs: number;
}

export interface ParsedFile {
  card?: Card;
  problems: Problem[];
  title?: string;
}

const KNOWN = new Set(Object.keys(FrontmatterSchema.shape));

export function zodProblems(err: z.ZodError): Problem[] {
  return err.issues.map((i) => ({ field: i.path.join(".") || "frontmatter", message: i.message }));
}

export function parseCard(text: string, relPath: string, mtimeMs = 0): ParsedFile {
  let parsed: matter.GrayMatterFile<string>;
  try {
    // gray-matter caches by content; pass an empty options object to avoid shared mutable results.
    parsed = matter(text, {});
  } catch (e) {
    return { problems: [{ field: "frontmatter", message: `invalid YAML: ${(e as Error).message}` }] };
  }
  const data = parsed.data as Record<string, unknown>;
  const title = typeof data.title === "string" ? data.title : undefined;
  const res = FrontmatterSchema.safeParse(data);
  if (!res.success) return { problems: zodProblems(res.error), title };
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!KNOWN.has(k)) extra[k] = v;
  return {
    card: { path: relPath, fm: res.data, body: parsed.content.replace(/^\n+/, ""), extra, mtimeMs },
    problems: [],
    title,
  };
}

function yamlScalar(s: string): string {
  const plain = /^[A-Za-z0-9À-ÿ_.\/~][^:#\[\]{},&*!|>'"%@`]*$/.test(s) && s === s.trim();
  const ambiguous = /^(true|false|yes|no|null|~|-?\d[\d._:-]*)$/i.test(s);
  return plain && !ambiguous ? s : JSON.stringify(s);
}

/** Stable, readable frontmatter: known fields in a fixed order, extra fields after. */
export function serializeCard(fm: Frontmatter, body: string, extra: Record<string, unknown> = {}): string {
  const lines = ["---", `title: ${yamlScalar(fm.title)}`, `status: ${fm.status}`, "sources:"];
  for (const s of fm.sources) lines.push(`  - ${yamlScalar(s)}`);
  lines.push(`tags: [${fm.tags.map(yamlScalar).join(", ")}]`);
  if (fm.kind) lines.push(`kind: ${fm.kind}`);
  if (fm.project) lines.push(`project: ${yamlScalar(fm.project)}`);
  lines.push(`created: ${fm.created}`, `updated: ${fm.updated}`);
  if (fm.session) lines.push(`session: ${yamlScalar(fm.session)}`);
  if (fm.summary) lines.push(`summary: ${yamlScalar(fm.summary)}`);
  for (const [k, v] of Object.entries(extra)) lines.push(`${k}: ${JSON.stringify(v)}`);
  lines.push("---", "");
  return lines.join("\n") + body.replace(/\s+$/, "") + "\n";
}

/** File name for a title. Obsidian resolves [[Title]] by file name, so they match as closely as possible. */
export function cardFileName(title: string): string {
  const cleaned = title
    .replace(/[\/\\:*?"<>|#^\[\]]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "");
  return (cleaned || "untitled").slice(0, 120) + ".md";
}

/** Key used to compare titles and link targets. */
export function titleKey(s: string): string {
  return s.normalize("NFC").trim().toLowerCase();
}

/** Looser key for duplicate detection: no accents, no punctuation. */
export function looseKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isExternalSource(s: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(s);
}

export function summaryOf(f: Card): string {
  if (f.fm.summary) return f.fm.summary;
  const line = f.body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("#") && !l.startsWith("```"));
  if (!line) return "";
  const plain = line
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|`)/g, "")
    .replace(/^([-*+]|\d+\.)\s+/, "")
    .replace(/^\|.*/, "");
  return plain.length > 140 ? plain.slice(0, 137) + "..." : plain;
}
