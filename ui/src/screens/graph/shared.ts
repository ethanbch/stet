import type { Graph } from "../../api";

export type Node = Graph["nodes"][number] & { x?: number; y?: number; z?: number };
export type Link = { source: string | Node; target: string | Node };

/** What both views receive from the screen. */
export type ViewProps = {
  data: Graph;
  onlyLoose: boolean;
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

/** Colour follows the first tag: the four biggest tags get series 1–4, the rest share series 5. */
export function tagColors(nodes: Graph["nodes"]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.tag, (counts.get(n.tag) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const map = new Map<string, string>();
  top.forEach((t, i) => map.set(t, i < 4 ? `--series-${i + 1}` : "--series-5"));
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

export function hasWebGL(): boolean {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    // Browsers cap live contexts, so release the probe right away.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl || !!document.createElement("canvas").getContext("webgl");
  } catch {
    return false;
  }
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
