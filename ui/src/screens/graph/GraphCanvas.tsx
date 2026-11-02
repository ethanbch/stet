import { useEffect, useRef } from "react";
import ForceGraph from "force-graph";
import { cssVar, groupOf, idOf, visible, type Link, type Node, type ViewProps } from "./shared";

/** Dot radius in graph units: small by default, larger for well-linked cards. */
const radius = (n: Node) => 2.2 + Math.sqrt(n.degree) * 1.5;

/** Pulls every node gently toward the centre, so orphans settle on a ring around the clusters instead of drifting away. */
function gravity(strength: number) {
  let nodes: Node[] = [];
  const force = (alpha: number) => {
    for (const n of nodes) {
      const v = n as Node & { vx: number; vy: number };
      v.vx -= (n.x ?? 0) * strength * alpha;
      v.vy -= (n.y ?? 0) * strength * alpha;
    }
  };
  force.initialize = (ns: Node[]) => (nodes = ns);
  return force;
}

/** Canvas colours: turn #rgb / #rrggbb into rgba; leave anything else as is. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * Math.max(0, Math.min(1, t));

export function GraphCanvas({ data, onlyLoose, colourBy, colors, neighbours, selected, onSelect, theme }: ViewProps) {
  const byTag = colourBy !== "none";
  const box = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph<Node, Link> | null>(null);
  // The canvas callbacks read these refs, so hover and selection repaint without restarting the layout.
  const hover = useRef<string | undefined>(undefined);
  const sel = useRef<string | undefined>(undefined);
  sel.current = selected;
  const select = useRef(onSelect);
  select.current = onSelect;
  const framed = useRef(false);

  useEffect(() => {
    if (!box.current) return;
    const dot = cssVar("--ink-muted");
    const ink = cssVar("--ink");
    const label = cssVar("--ink-secondary");
    const edge = cssVar("--border-strong");
    const accent = cssVar("--accent");
    const font = cssVar("--font-sans");
    const faint = withAlpha(edge, 0.25);
    const { nodes, links } = visible(data, onlyLoose);
    const focus = () => hover.current ?? sel.current;
    const near = (id: string) => {
      const f = focus();
      return !!f && (f === id || !!neighbours.get(f)?.has(id));
    };
    const touches = (l: Link) => {
      const f = focus();
      return !!f && (idOf(l.source) === f || idOf(l.target) === f);
    };
    const fill = (n: Node) => (byTag ? cssVar(colors.get(groupOf(n, colourBy)) ?? "--series-5") : dot);

    framed.current = false;
    if (!graph.current) graph.current = new ForceGraph<Node, Link>(box.current);
    const g = graph.current;
    g.width(box.current.clientWidth)
      .height(box.current.clientHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .nodeLabel(() => "")
      .nodeRelSize(1)
      .nodeVal((n: Node) => radius(n) ** 2)
      .linkColor((l: Link) => {
        const f = focus();
        if (!f) return edge;
        return touches(l) ? accent : faint;
      })
      .linkWidth((l: Link) => (touches(l) ? 1.2 : 0.6))
      .linkDirectionalArrowLength(0)
      .onNodeHover((n: Node | null) => {
        hover.current = n?.id;
        if (box.current) box.current.style.cursor = n ? "pointer" : "default";
      })
      .onNodeClick((n: Node) => select.current(sel.current === n.id ? undefined : n.id))
      .onBackgroundClick(() => select.current(undefined))
      .nodeCanvasObject((n: Node, ctx: CanvasRenderingContext2D, scale: number) => {
        const r = radius(n);
        const f = focus();
        const isFocus = n.id === f;
        const dim = !!f && !near(n.id);
        ctx.globalAlpha = dim ? 0.12 : 1;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
        ctx.fillStyle = isFocus ? accent : f && !dim && !byTag ? ink : fill(n);
        ctx.fill();

        ctx.globalAlpha = 1;
      })
      .nodePointerAreaPaint((n: Node, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n) + 3, 0, 2 * Math.PI);
        ctx.fill();
      })
      // Labels go on top of every dot, most-linked first; a label that would cover one already drawn is skipped.
      .onRenderFramePost((ctx: CanvasRenderingContext2D, scale: number) => {
        const f = focus();
        const zoomAlpha = mix(0, 1, (scale - 1.1) / 0.8);
        if (!f && zoomAlpha <= 0.02) return;
        const shown = nodes
          .filter((n) => (f ? near(n.id) : true) && n.x !== undefined)
          .sort((a, b) => Number(b.id === f) - Number(a.id === f) || b.degree - a.degree || a.id.localeCompare(b.id));
        const size = 11 / scale; // 11 px on screen whatever the zoom
        const pad = 3 / scale;
        // Dots are obstacles too, so a label never covers another card.
        const dots = (f ? nodes.filter((n) => near(n.id)) : nodes).filter((n) => n.x !== undefined);
        const hitsDot = (b: [number, number, number, number], self: Node) =>
          dots.some((d) => {
            if (d === self) return false;
            const r = radius(d);
            return b[0] < d.x! + r && b[2] > d.x! - r && b[1] < d.y! + r && b[3] > d.y! - r;
          });
        const placed: [number, number, number, number][] = [];
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (const n of shown) {
          const isFocus = n.id === f;
          ctx.font = `${isFocus ? 600 : 400} ${size}px ${font}`;
          const w = ctx.measureText(n.id).width;
          const x0 = n.x! - w / 2 - pad;
          const h = size * 1.25;
          const free = (b: [number, number, number, number]) =>
            !placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]) && !hitsDot(b, n);
          // Below the dot first, then above it.
          const below: [number, number, number, number] = [x0, n.y! + radius(n) + 2, x0 + w + 2 * pad, n.y! + radius(n) + 2 + h];
          const above: [number, number, number, number] = [x0, n.y! - radius(n) - 2 - h, x0 + w + 2 * pad, n.y! - radius(n) - 2];
          const box = isFocus || free(below) ? below : free(above) ? above : undefined;
          if (!box) continue;
          const y0 = box[1];
          placed.push(box);
          ctx.globalAlpha = f ? 1 : zoomAlpha;
          ctx.fillStyle = isFocus ? ink : label;
          ctx.fillText(n.id, n.x!, y0);
        }
        ctx.globalAlpha = 1;
      })
      .warmupTicks(60)
      .cooldownTicks(200)
      .onEngineStop(() => {
        // Frame once per layout; later stops (after a drag) leave the view where the user put it.
        if (framed.current) return;
        framed.current = true;
        g.zoomToFit(500, 48);
      })
      .graphData({ nodes, links });
    g.d3Force("charge")?.strength(-40).distanceMax(220);
    g.d3Force("link")?.distance(28).strength(0.6);
    g.d3Force("center", null);
    g.d3Force("gravity", gravity(0.04));
  }, [data, onlyLoose, colourBy, byTag, colors, theme, neighbours]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => graph.current?.width(el.clientWidth).height(el.clientHeight));
    ro.observe(el);
    return () => {
      ro.disconnect();
      graph.current?._destructor();
      graph.current = null;
      el.replaceChildren();
    };
  }, []);

  return <div className="graph" ref={box} role="img" aria-label="Graph of links between cards" />;
}
