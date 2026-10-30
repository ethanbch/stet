import { useEffect, useMemo, useState } from "react";
import { ficheHref, useData, type Graph } from "../api";
import { Status } from "../components/Reader";
import { Graph2D } from "./graph/Graph2D";
import { Graph3D } from "./graph/Graph3D";
import { hasWebGL, neighbourMap, tagColors } from "./graph/shared";

type Mode = "3d" | "2d";
const MODE_KEY = "stet-graph-mode";

function storedMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

export function GraphScreen() {
  const { data } = useData<Graph>("/api/graph");
  const [onlyLoose, setOnlyLoose] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [theme, setTheme] = useState(0);
  const [webgl, setWebgl] = useState(hasWebGL);
  const [chosen, setChosen] = useState<Mode>(storedMode);
  const mode: Mode = webgl ? chosen : "2d";

  const colors = useMemo(() => tagColors(data?.nodes ?? []), [data]);
  const neighbours = useMemo(() => neighbourMap(data?.links ?? []), [data]);

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

  const pick = (m: Mode) => {
    setChosen(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // Private mode or blocked storage: the choice just won't be remembered.
    }
  };

  const node = data?.nodes.find((n) => n.id === selected);
  const orphans = data?.nodes.filter((n) => n.orphan).length ?? 0;
  const legend = [...colors].reduce<{ label: string; color: string }[]>((acc, [tag, color]) => {
    if (color === "--series-5") {
      if (!acc.some((a) => a.color === color)) acc.push({ label: "Other tags", color });
    } else acc.push({ label: tag, color });
    return acc;
  }, []);

  const view = data && { data, onlyLoose, colors, neighbours, selected, onSelect: setSelected, theme };

  return (
    <div className="graph-wrap">
      {view && (mode === "3d" ? <Graph3D {...view} onFail={() => setWebgl(false)} /> : <Graph2D {...view} />)}
      <div className="graph-title">
        <h1 className="page-title">Graph</h1>
        <p className="page-sub">Click a fiche to see its links. A ring marks an orphan or a separate group.</p>
      </div>
      <aside className="graph-panel">
        {webgl && (
          <div className="ro-segmented graph-mode" role="group" aria-label="View">
            {(["3d", "2d"] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>
                {m.toUpperCase()}
              </button>
            ))}
          </div>
        )}
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
