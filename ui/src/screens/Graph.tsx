import { useEffect, useMemo, useState } from "react";
import { cardHref, useData, type Graph } from "../api";
import { Status } from "../components/Reader";
import { GraphCanvas } from "./graph/GraphCanvas";
import { neighbourMap, tagColors, type ColourBy } from "./graph/shared";

const COLOUR_KEY = "stet-graph-colour";

const IconSliders = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
    <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
    <circle cx="10" cy="4.5" r="1.5" />
    <circle cx="6" cy="11.5" r="1.5" />
  </svg>
);

export function GraphScreen() {
  const { data } = useData<Graph>("/api/graph");
  const [onlyLoose, setOnlyLoose] = useState(false);
  const [colourBy, setColourBy] = useState<ColourBy>(() => {
    try {
      const v = localStorage.getItem(COLOUR_KEY);
      return v === "project" || v === "kind" || v === "tag" ? v : "none";
    } catch {
      return "none";
    }
  });
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [theme, setTheme] = useState(0);

  const colors = useMemo(() => tagColors(data?.nodes ?? [], colourBy), [data, colourBy]);
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

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSettings(false);
        setSelected(undefined);
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  const node = data?.nodes.find((n) => n.id === selected);
  const orphans = data?.nodes.filter((n) => n.orphan).length ?? 0;
  const legend = [...colors].reduce<{ label: string; color: string }[]>((acc, [tag, color]) => {
    if (color === "--series-5") {
      if (!acc.some((a) => a.color === color)) {
        // The grey dot holds the cards with no project (or kind) and, past four groups, the smaller ones.
        const grey = [...colors].filter(([, c]) => c === "--series-5").map(([g]) => g);
        const none = grey.find((g) => g === "No project" || g === "No kind");
        const others = grey.filter((g) => g !== none).length;
        acc.push({ label: none ? (others ? `${none}, others` : none) : "Others", color });
      }
    } else acc.push({ label: tag, color });
    return acc;
  }, []);
  const linked = node ? (neighbours.get(node.id)?.size ?? 0) : 0;

  return (
    <div className="graph-wrap">
      {data && (
        <GraphCanvas
          data={data}
          onlyLoose={onlyLoose}
          colourBy={colourBy}
          colors={colors}
          neighbours={neighbours}
          selected={selected}
          onSelect={setSelected}
          theme={theme}
        />
      )}
      {!data && <p className="graph-loading">Loading the graph…</p>}

      <p className="graph-stats">
        {data?.nodes.length ?? 0} cards · {data?.links.length ?? 0} links
        {orphans > 0 && ` · ${orphans} orphan${orphans === 1 ? "" : "s"}`}
      </p>

      <div className="graph-tools">
        <button
          type="button"
          className="icon-button graph-tools__toggle"
          aria-expanded={settings}
          aria-label="Display options"
          title="Display options"
          onClick={() => setSettings((s) => !s)}
        >
          <IconSliders />
        </button>
        {settings && (
          <div className="graph-popover" role="group" aria-label="Display options">
            <div className="ro-segmented graph-colour" role="group" aria-label="Colour by">
              {(["none", "project", "kind", "tag"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={colourBy === c}
                  onClick={() => {
                    setColourBy(c);
                    try {
                      localStorage.setItem(COLOUR_KEY, c);
                    } catch {
                      // private mode: the choice lasts for this window
                    }
                  }}
                >
                  {c === "none" ? "None" : c === "tag" ? "Topic" : c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={onlyLoose} onChange={(e) => setOnlyLoose(e.target.checked)} />
              Only orphans and separate groups
            </label>
            {colourBy !== "none" && (
              <ul className="legend">
                {legend.map((l) => (
                  <li key={l.label}>
                    <span className="swatch" style={{ background: `var(${l.color})` }} />
                    {l.label}
                  </li>
                ))}
              </ul>
            )}
            <p className="graph-popover__hint">Scroll to zoom, drag to move. Labels appear as you zoom in.</p>
          </div>
        )}
      </div>

      {node && (
        <div className="graph-card">
          <Status status={node.status} />
          <h2 className="graph-card__title">{node.id}</h2>
          <p className="graph-card__meta">
            {linked} linked {linked === 1 ? "card" : "cards"}
            {node.orphan ? " · nothing links here" : ""}
          </p>
          <a className="ro-button ro-button--primary graph-card__open" href={cardHref(node.id)}>
            Open the card
          </a>
        </div>
      )}
    </div>
  );
}
