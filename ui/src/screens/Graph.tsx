import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph from "force-graph";
import { ficheHref, useData, type Graph } from "../api";
import { Card } from "../readout/Card";

type Node = Graph["nodes"][number] & { x?: number; y?: number };

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
  const graph = useRef<ForceGraph<Node> | null>(null);
  const [onlyLoose, setOnlyLoose] = useState(false);
  const [theme, setTheme] = useState(0);

  const colors = useMemo(() => tagColors(data?.nodes ?? []), [data]);

  // Repaint when the theme changes, since canvas colours are read from CSS variables.
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
    const edge = cssVar("--axis");
    const warn = cssVar("--status-warning");
    const font = cssVar("--font-sans");
    const nodes: Node[] = data.nodes
      .filter((n) => !onlyLoose || n.orphan || n.island)
      .map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = data.links.filter((l) => ids.has(l.source) && ids.has(l.target)).map((l) => ({ ...l }));

    if (!graph.current) graph.current = new ForceGraph<Node>(box.current);
    const g = graph.current;
    g.width(box.current.clientWidth)
      .height(box.current.clientHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .nodeId("id")
      .nodeLabel((n: Node) => n.id)
      .linkColor(() => edge)
      .linkDirectionalArrowLength(3)
      .linkDirectionalArrowRelPos(1)
      .onNodeClick((n: Node) => (location.hash = ficheHref(n.id)))
      .nodeCanvasObject((n: Node, ctx: CanvasRenderingContext2D, scale: number) => {
        const r = 4 + Math.min(6, n.degree);
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
        ctx.fillStyle = cssVar(colors.get(n.tag) ?? "--series-5");
        ctx.fill();
        if (n.orphan || n.island) {
          ctx.lineWidth = 2 / scale;
          ctx.strokeStyle = warn;
          ctx.beginPath();
          ctx.arc(n.x!, n.y!, r + 3 / scale, 0, 2 * Math.PI);
          ctx.stroke();
        }
        if (scale > 0.9 || nodes.length < 40) {
          const size = 12 / scale;
          ctx.font = `${size}px ${font}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillStyle = n.status === "draft" ? muted : ink;
          ctx.fillText(n.id, n.x!, n.y! + r + 3 / scale);
        }
      })
      .nodePointerAreaPaint((n: Node, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, 10, 0, 2 * Math.PI);
        ctx.fill();
      })
      .cooldownTicks(120)
      .onEngineStop(() => g.zoomToFit(300, 48))
      .graphData({ nodes, links });
    g.d3Force("charge")?.strength(-160);
    g.d3Force("link")?.distance(70);

    const resize = () => box.current && g.width(box.current.clientWidth).height(box.current.clientHeight);
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, [data, onlyLoose, colors, theme]);

  useEffect(
    () => () => {
      graph.current?._destructor();
      graph.current = null;
    },
    [],
  );

  const orphans = data?.nodes.filter((n) => n.orphan).length ?? 0;
  const legend = [...colors].reduce<{ label: string; color: string }[]>((acc, [tag, color]) => {
    if (color === "--series-5") {
      if (!acc.some((a) => a.color === color)) acc.push({ label: "Other tags", color });
    } else acc.push({ label: tag, color });
    return acc;
  }, []);

  return (
    <div className="grid grid--main-side">
      <Card>
        <div className="graph" ref={box} role="img" aria-label="Graph of links between fiches" />
        {data && !data.nodes.length && <p className="empty" style={{ marginTop: 12 }}>No fiches yet.</p>}
      </Card>
      <div className="stack">
        <Card title="Graph" info="Each dot is a fiche, each arrow a [[link]]. Click a dot to open the fiche. A ring marks an orphan (nothing links to it) or a fiche outside the main group.">
          <dl className="ro-facts" style={{ marginTop: 0 }}>
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
          <label className="check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={onlyLoose} onChange={(e) => setOnlyLoose(e.target.checked)} />
            Show only orphans and separate groups
          </label>
        </Card>
        <Card title="Legend">
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
        </Card>
      </div>
    </div>
  );
}
