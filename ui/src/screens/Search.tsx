import { useEffect, useMemo, useState } from "react";
import { ficheHref, formatDay, hashParams, useData, type Hit } from "../api";
import { Card } from "../readout/Card";
import { Status } from "./Home";

type Sort = "relevance" | "updated";

export function SearchScreen() {
  const initial = hashParams();
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [tag, setTag] = useState(initial.get("tag") ?? "");
  const [status, setStatus] = useState(initial.get("status") ?? "");
  const [sort, setSort] = useState<Sort>("relevance");
  const [debounced, setDebounced] = useState(q);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);

  // Keep the filters in the URL so a search can be bookmarked or reopened.
  useEffect(() => {
    const p = new URLSearchParams();
    if (debounced) p.set("q", debounced);
    if (tag) p.set("tag", tag);
    if (status) p.set("status", status);
    const next = `#/search${p.size ? `?${p}` : ""}`;
    if (location.hash !== next) history.replaceState(null, "", next);
  }, [debounced, tag, status]);

  const params = new URLSearchParams();
  if (debounced) params.set("q", debounced);
  if (tag) params.set("tag", tag);
  if (status) params.set("status", status);
  const { data, stale } = useData<Hit[]>(`/api/search?${params}`);
  const { data: tags } = useData<{ tag: string; count: number }[]>("/api/tags");

  const hits = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort === "updated" || !debounced) list.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
    return list;
  }, [data, sort, debounced]);

  return (
    <Card>
      <input
        className="input input--search"
        type="search"
        placeholder="Search titles, tags and text"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search the wiki"
      />
      <div className="toolbar">
        <select className="ro-select" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag">
          <option value="">All tags</option>
          {tags?.map((t) => (
            <option key={t.tag} value={t.tag}>
              {t.tag} ({t.count})
            </option>
          ))}
        </select>
        <div className="ro-segmented" role="group" aria-label="Status">
          {[
            ["", "All"],
            ["draft", "To review"],
            ["validated", "Validated"],
          ].map(([v, label]) => (
            <button key={v} aria-pressed={status === v} onClick={() => setStatus(v)}>
              {label}
            </button>
          ))}
        </div>
        {debounced && (
          <div className="ro-segmented" role="group" aria-label="Sort">
            {(["relevance", "updated"] as Sort[]).map((s) => (
              <button key={s} aria-pressed={sort === s} onClick={() => setSort(s)}>
                {s === "relevance" ? "Best match" : "Latest"}
              </button>
            ))}
          </div>
        )}
        <span className="row__meta" style={{ marginLeft: "auto" }}>
          {hits.length} {hits.length === 1 ? "fiche" : "fiches"}
        </span>
      </div>
      <ul className={`rows ${stale ? "is-stale" : ""}`}>
        {hits.map((h) => (
          <li key={h.title}>
            <a className="row" href={ficheHref(h.title)} style={{ alignItems: "flex-start" }}>
              <span className="row__main">
                <span className="row__title">{h.title}</span>
                <span className="row__sub" style={{ whiteSpace: "normal" }}>
                  {h.excerpt}
                </span>
                <span className="tags" style={{ marginTop: 6 }}>
                  {h.tags.map((t) => (
                    <span key={t} className="ro-pill">
                      {t}
                    </span>
                  ))}
                </span>
              </span>
              <span className="row__meta" style={{ display: "grid", justifyItems: "end", gap: 4 }}>
                <Status status={h.status} />
                {h.updated && formatDay(h.updated)}
              </span>
            </a>
          </li>
        ))}
      </ul>
      {data && !hits.length && <p className="empty">No fiche matches. Try fewer words or another filter.</p>}
    </Card>
  );
}
