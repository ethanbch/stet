import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "force-graph";
import { ficheHref, useData, type Graph } from "../api";
import { Status } from "../components/Reader";

type Node = Graph["nodes"][number] & { x?: number; y?: number };
type Link = { source: string | Node; target: string | Node };

const idOf = (v: string | Node) => (typeof v === "string" ? v : v.id);

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Colour follows the first tag: the four biggest tags get series 1–4, the rest share series 5. */
function tagColors(nodes: Node[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.tag, (counts.get(n.tag) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
  const map = new Map<string, string>();
  top.forEach((t, i) => map.set(t, i < 4 ? `--series-${i + 1}` : "--series-5"));
  return map;
}

export function GraphScreen() {
  const { data } = useData<Graph>("/api/graph");
  const box = useRef<HTMLDivElement>(null);
  const graph = useRef<ForceGraph<Node, Link> | null>(null);
  const [onlyLoose, setOnlyLoose] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [theme, setTheme] = useState(0);
  // The canvas callbacks read these refs, so hover and selection repaint without restarting the layout.
  const hover = useRef<string | undefined>(undefined);
  const sel = useRef<string | undefined>(undefined);
  sel.current = selected;

  const colors = useMemo(() => tagColors(data?.nodes ?? []), [data]);
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of data?.links ?? []) {
      if (!m.has(l.source)) m.set(l.source, new Set());
      if (!m.has(l.target)) m.set(l.target, new Set());
      m.get(l.source)!.add(l.target);
      m.get(l.target)!.add(l.source);
    }
    return m;
  }, [data]);

  // Canvas colours come from CSS variables: repaint when the theme changes.
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setTheme((t) => t + 1);
    mq.addEventListener("change", on);
    const obs = new MutationObserver(on);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", on);
      obs.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!box.current || !data) return;
    const ink = cssVar("--ink");
    const muted = cssVar("--ink-muted");
    const edge = cssVar("--border-strong");
    const accent = cssVar("--accent");
    const warn = cssVar("--status-warning");
    const page = cssVar("--page");
    const font = cssVar("--font-sans");
    const nodes: Node[] = data.nodes.filter((n) => !onlyLoose || n.orphan || n.island).map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links: Link[] = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));
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
      .onNodeClick((n: Node) => setSelected((s) => (s === n.id ? undefined : n.id)))
      .onBackgroundClick(() => setSelected(undefined))
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

    const resize = () => box.current && g.width(box.current.clientWidth).height(box.current.clientHeight);
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, [data, onlyLoose, colors, theme, neighbours]);

  useEffect(
    () => () => {
      graph.current?._destructor();
      graph.current = null;
    },
    [],
  );

  const node = data?.nodes.find((n) => n.id === selected);
  const orphans = data?.nodes.filter((n) => n.orphan).length ?? 0;
  const legend = [...colors].reduce<{ label: string; color: string }[]>((acc, [tag, color]) => {
    if (color === "--series-5") {
      if (!acc.some((a) => a.color === color)) acc.push({ label: "Other tags", color });
    } else acc.push({ label: tag, color });
    return acc;
  }, []);

  return (
    <div className="graph-wrap">
      <div className="graph" ref={box} role="img" aria-label="Graph of links between fiches" />
      <div className="graph-title">
        <h1 className="page-title">Graph</h1>
        <p className="page-sub">Click a fiche to see its links. A ring marks an orphan or a separate group.</p>
      </div>
      <aside className="graph-panel">
        {node ? (
          <div>
            <Status status={node.status} />
            <h2 style={{ margin: "8px 0 4px", fontSize: 16, lineHeight: "22px", fontWeight: 600 }}>{node.id}</h2>
            <p className="page-sub" style={{ margin: 0, fontSize: 12.5 }}>
              {neighbours.get(node.id)?.size ?? 0} linked {neighbours.get(node.id)?.size === 1 ? "fiche" : "fiches"}
              {node.orphan ? " · nothing links here" : ""}
            </p>
            <a className="ro-button ro-button--primary" style={{ marginTop: 12, width: "100%" }} href={ficheHref(node.id)}>
              Open the fiche
            </a>
          </div>
        ) : (
          <dl className="facts-inline">
            <div>
              <dt>Fiches</dt>
              <dd>{data?.nodes.length ?? 0}</dd>
            </div>
            <div>
              <dt>Links</dt>
              <dd>{data?.links.length ?? 0}</dd>
            </div>
            <div>
              <dt>Orphans</dt>
              <dd>{orphans}</dd>
            </div>
            <div>
              <dt>Separate groups</dt>
              <dd>{data?.islands ?? 0}</dd>
            </div>
          </dl>
        )}
        <ul className="legend">
          {legend.map((l) => (
            <li key={l.label}>
              <span className="swatch" style={{ background: `var(${l.color})` }} />
              {l.label}
            </li>
          ))}
          <li>
            <span className="swatch swatch--ring" />
            Orphan or separate group
          </li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={onlyLoose} onChange={(e) => setOnlyLoose(e.target.checked)} />
          Only orphans and separate groups
        </label>
      </aside>
    </div>
  );
}
