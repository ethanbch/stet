import { useEffect, useRef } from "react";
import ForceGraph from "force-graph";
import { cssVar, idOf, visible, type Link, type Node, type ViewProps } from "./shared";

export function Graph2D({ data, onlyLoose, colors, neighbours, selected, onSelect, theme }: ViewProps) {
  const box = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph<Node, Link> | null>(null);
  // The canvas callbacks read these refs, so hover and selection repaint without restarting the layout.
  const hover = useRef<string | undefined>(undefined);
  const sel = useRef<string | undefined>(undefined);
  sel.current = selected;
  const select = useRef(onSelect);
  select.current = onSelect;

  useEffect(() => {
    if (!box.current) return;
    const ink = cssVar("--ink");
    const muted = cssVar("--ink-muted");
    const edge = cssVar("--border-strong");
    const accent = cssVar("--accent");
    const warn = cssVar("--status-warning");
    const page = cssVar("--page");
    const font = cssVar("--font-sans");
    const { nodes, links } = visible(data, onlyLoose);
    const focus = () => sel.current ?? hover.current;
    const lit = (id: string) => {
      const f = focus();
      return !f || f === id || !!neighbours.get(f)?.has(id);
    };
    const touches = (l: Link) => {
      const f = focus();
      return !!f && (idOf(l.source) === f || idOf(l.target) === f);
    };

    if (!graph.current) graph.current = new ForceGraph<Node, Link>(box.current);
    const g = graph.current;
    g.width(box.current.clientWidth)
      .height(box.current.clientHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .nodeLabel(() => "")
      .linkColor((l: Link) => (touches(l) ? accent : edge))
      .linkWidth((l: Link) => (touches(l) ? 1.6 : 0.8))
      .linkDirectionalArrowLength(3.5)
      .linkDirectionalArrowRelPos(1)
      .onNodeHover((n: Node | null) => {
        hover.current = n?.id;
        if (box.current) box.current.style.cursor = n ? "pointer" : "default";
      })
      .onNodeClick((n: Node) => select.current(sel.current === n.id ? undefined : n.id))
      .onBackgroundClick(() => select.current(undefined))
      .nodeCanvasObject((n: Node, ctx: CanvasRenderingContext2D, scale: number) => {
        const r = 5 + Math.min(7, n.degree * 1.2);
        const f = focus();
        const on = lit(n.id);
        ctx.globalAlpha = on ? 1 : 0.16;
        if (n.orphan || n.island) {
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 3.5, 0, 2 * Math.PI);
          ctx.strokeStyle = warn;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
        ctx.fillStyle = cssVar(colors.get(n.tag) ?? "--series-5");
        ctx.fill();
        if (n.id === f) {
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = page;
          ctx.stroke();
        }
        // Labels: the focus and its neighbours, every fiche in a small wiki, the rest once zoomed in.
        if (on && (scale > 1.1 || nodes.length <= 24 || n.degree >= 3 || n.id === f)) {
          const size = Math.max(10, 12.5 / scale);
          ctx.font = `${n.id === f ? 600 : 500} ${size}px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          const y = n.y! + r + 5;
          ctx.lineWidth = 4 / scale;
          ctx.strokeStyle = page;
          ctx.strokeText(n.id, n.x!, y);
          ctx.fillStyle = n.status === "draft" ? muted : ink;
          ctx.fillText(n.id, n.x!, y);
        }
        ctx.globalAlpha = 1;
      })
      .nodePointerAreaPaint((n: Node, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, 12, 0, 2 * Math.PI);
        ctx.fill();
      })
      .cooldownTicks(150)
      .onEngineStop(() => g.zoomToFit(400, 120))
      .graphData({ nodes, links });
    // A bounded charge keeps separate groups near each other instead of drifting off screen.
    g.d3Force("charge")?.strength(-180).distanceMax(260);
    g.d3Force("link")?.distance(80);
  }, [data, onlyLoose, colors, theme, neighbours]);

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

  return <div className="graph" ref={box} role="img" aria-label="Graph of links between fiches" />;
}
