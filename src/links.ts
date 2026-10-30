import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { visit, SKIP } from "unist-util-visit";
import type { Root, Text, PhrasingContent, Parent } from "mdast";

export interface WikiLink {
  target: string;
  alias?: string;
  heading?: string;
}

const WIKI_RE = /\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]*))?\]\]/g;

function parse(md: string): Root {
  return unified().use(remarkParse).use(remarkGfm).parse(md) as Root;
}

/** Wiki links in prose; links inside code spans and code blocks are ignored. */
export function extractLinks(md: string): WikiLink[] {
  const out: WikiLink[] = [];
  visit(parse(md), "text", (node: Text) => {
    for (const m of node.value.matchAll(WIKI_RE)) {
      out.push({ target: m[1].trim(), heading: m[2]?.slice(1) || undefined, alias: m[3]?.trim() || undefined });
    }
  });
  return out;
}

/** Turns [[links]] into anchors. `resolve` returns the fiche title for a target, or undefined when missing. */
function remarkWikiLinks(resolve: (target: string) => string | undefined) {
  return () => (tree: Root) => {
    visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
      if (!parent || index === undefined || !node.value.includes("[[")) return;
      const parts: PhrasingContent[] = [];
      let last = 0;
      for (const m of node.value.matchAll(WIKI_RE)) {
        if (m.index! > last) parts.push({ type: "text", value: node.value.slice(last, m.index) });
        const target = m[1].trim();
        const label = m[3]?.trim() || target;
        const title = resolve(target);
        parts.push({
          type: "link",
          url: title ? `#/wiki/${encodeURIComponent(title)}` : "#",
          children: [{ type: "text", value: label }],
          data: { hProperties: { className: title ? ["wikilink"] : ["wikilink", "broken"], "data-target": target } },
        });
        last = m.index! + m[0].length;
      }
      if (!parts.length) return;
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      parent.children.splice(index, 1, ...(parts as never[]));
      return [SKIP, index + parts.length];
    });
  };
}

/** Markdown to HTML for the reader. Raw HTML in fiches is dropped, never rendered. */
export function renderMarkdown(md: string, resolve: (target: string) => string | undefined): string {
  const file = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikiLinks(resolve))
    .use(remarkRehype)
    .use(rehypeStringify)
    .processSync(md);
  return String(file);
}
