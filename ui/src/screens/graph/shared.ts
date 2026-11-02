import type { Graph } from "../../api";

export type Node = Graph["nodes"][number] & { x?: number; y?: number; z?: number };
export type Link = { source: string | Node; target: string | Node };

/** What both views receive from the screen. */
export type ViewProps = {
  data: Graph;
  onlyLoose: boolean;
  /** What colours the dots; "none" keeps one neutral grey. */
  colourBy: ColourBy;
  colors: Map<string, string>;
  neighbours: Map<string, Set<string>>;
  selected?: string;
  onSelect: (id: string | undefined) => void;
  /** Bumped when the theme changes, so colours are read again. */
  theme: number;
};

export const idOf = (v: string | Node) => (typeof v === "string" ? v : v.id);

export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export type ColourBy = "none" | "project" | "kind" | "tag";

/** The group a node is coloured by. */
export const groupOf = (n: Graph["nodes"][number], by: ColourBy) => (by === "project" ? n.project : by === "kind" ? n.kind : n.tag);

/** Colour follows the chosen group: the four biggest get series 1–4, the rest share series 5. */
export function tagColors(nodes: Graph["nodes"], by: ColourBy = "tag"): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(groupOf(n, by), (counts.get(groupOf(n, by)) ?? 0) + 1);
  // "No project" and "No kind" stay grey, with the small groups; named groups get the colours.
  const unnamed = (g: string) => g === "No project" || g === "No kind";
  const top = [...counts]
    .filter(([g]) => !unnamed(g))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
  const map = new Map<string, string>();
  top.forEach((t, i) => map.set(t, i < 4 ? `--series-${i + 1}` : "--series-5"));
  for (const g of counts.keys()) if (unnamed(g)) map.set(g, "--series-5");
  return map;
}

export function neighbourMap(links: Graph["links"]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const l of links) {
    if (!m.has(l.source)) m.set(l.source, new Set());
    if (!m.has(l.target)) m.set(l.target, new Set());
    m.get(l.source)!.add(l.target);
    m.get(l.target)!.add(l.source);
  }
  return m;
}

/** Fresh copies: the force layouts write positions onto the objects they get. */
export function visible(data: Graph, onlyLoose: boolean): { nodes: Node[]; links: Link[] } {
  const nodes: Node[] = data.nodes.filter((n) => !onlyLoose || n.orphan || n.island).map((n) => ({ ...n }));
  const ids = new Set(nodes.map((n) => n.id));
  const links: Link[] = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
  return { nodes, links };
}
