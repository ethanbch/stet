import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cardHref, formatDay, hashParams, useData, type Hit, type Projects } from "../api";

const NONE = "\u0000none";
import { Reader, Status } from "../components/Reader";
import { useListKeys } from "../components/useListKeys";

export function CardsScreen({ title }: { title?: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState(() => hashParams().get("tag") ?? "");
  const [status, setStatus] = useState("");
  const [project, setProject] = useState(() => hashParams().get("project") ?? "");
  const [kind, setKind] = useState("");
  // Project groups you folded, remembered in this browser.
  const [folded, setFolded] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("stet-folded") ?? "[]"));
    } catch {
      return new Set();
    }
  });
  const fold = (g: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      try {
        localStorage.setItem("stet-folded", JSON.stringify([...n]));
      } catch {
        // private mode: folding lasts for this window
      }
      return n;
    });
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = hashParams().get("tag");
    if (t !== null) setTag(t);
  }, [title]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 120);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (debounced.trim()) params.set("q", debounced.trim());
  if (tag) params.set("tag", tag);
  if (status) params.set("status", status);
  if (project) params.set("project", project);
  if (kind) params.set("kind", kind);
  const { data, stale } = useData<Hit[]>(`/api/search?${params}`);
  const { data: tags } = useData<{ tag: string; count: number }[]>("/api/tags");
  const { data: facets } = useData<Projects>("/api/projects");

  const hits = useMemo(() => {
    const list = [...(data ?? [])];
    if (!debounced.trim()) list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [data, debounced]);

  // Without a search, cards are grouped by project, like folders filled for you. "No project" comes last.
  const groups = useMemo(() => {
    if (debounced.trim() || project) return [{ name: "", cards: hits }];
    const m = new Map<string, Hit[]>();
    for (const h of hits) m.set(h.project ?? NONE, [...(m.get(h.project ?? NONE) ?? []), h]);
    return [...m]
      .sort(([a], [b]) => (a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b)))
      .map(([name, cards]) => ({ name, cards }));
  }, [hits, debounced, project]);
  const visibleHits = useMemo(() => groups.flatMap((g) => (folded.has(g.name) ? [] : g.cards)), [groups, folded]);

  const current = title ?? visibleHits[0]?.title;
  const titles = useMemo(() => visibleHits.map((h) => h.title), [visibleHits]);
  const go = useCallback((t: string) => location.replace(cardHref(t)), []);
  useListKeys(titles, current, go);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "f") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  return (
    <div className="split">
      <div className="pane">
        <div className="pane__head">
          <h1 className="pane__title">
            Cards <span className="mono muted" style={{ fontSize: 12, fontWeight: 400 }}>{hits.length} {hits.length === 1 ? "card" : "cards"}</span>
          </h1>
          <input
            ref={input}
            className="filter-input"
            type="search"
            placeholder="Filter by words"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter cards by words"
          />
          <div className="filter-row" role="group" aria-label="Filters">
            {[
              ["", "All"],
              ["draft", "To review"],
              ["validated", "Validated"],
            ].map(([v, label]) => (
              <button key={v} className="tag" aria-pressed={status === v} onClick={() => setStatus(v)} style={{ fontFamily: "var(--font-sans)" }}>
                {label}
              </button>
            ))}
          </div>
          <div className="filter-row" role="group" aria-label="Project and kind">
            <label className={`meta-pick ${project ? "is-set" : ""}`}>
              <span className="sr-only">Project</span>
              <select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">All projects</option>
                {(facets?.projects ?? []).map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name} ({p.count})
                  </option>
                ))}
                {!!facets?.none && <option value="-">No project ({facets.none})</option>}
              </select>
            </label>
            <label className={`meta-pick ${kind ? "is-set" : ""}`}>
              <span className="sr-only">Kind</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="">All kinds</option>
                {(facets?.kinds ?? [])
                  .filter((k) => k.count)
                  .map((k) => (
                    <option key={k.name} value={k.name}>
                      {k.name} ({k.count})
                    </option>
                  ))}
              </select>
            </label>
          </div>
          {!!tags?.length && (
            <div className="filter-row" role="group" aria-label="Topics">
              {tags.slice(0, 10).map((t) => (
                <button key={t.tag} className="tag" aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? "" : t.tag)}>
                  {t.tag} <span style={{ opacity: 0.6, marginLeft: 4 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={`pane__body ${stale ? "is-stale" : ""}`} role="listbox" aria-label="Cards">
          {groups.map((g) => (
            <div key={g.name || "all"} className="pane__group">
              {g.name && (
                <button className="group-head" aria-expanded={!folded.has(g.name)} onClick={() => fold(g.name)}>
                  <span className="group-head__chevron" aria-hidden />
                  <span className="group-head__name">{g.name === NONE ? "No project" : g.name}</span>
                  <span className="mono muted">{g.cards.length}</span>
                </button>
              )}
              {!folded.has(g.name) &&
                g.cards.map((h) => (
                  <a
                    key={h.title}
                    className="queue-item"
                    role="option"
                    aria-selected={h.title.toLowerCase() === current?.toLowerCase()}
                    href={cardHref(h.title)}
                  >
                    <span className="queue-item__title">{h.title}</span>
                    {h.excerpt && <span className="queue-item__sub">{h.excerpt}</span>}
                    <span className="queue-item__meta">
                      <Status status={h.status} />
                      {h.kind && <span className="badge">{h.kind}</span>}
                      {h.updated && <span className="mono">{formatDay(h.updated)}</span>}
                    </span>
                  </a>
                ))}
            </div>
          ))}
          {data && !hits.length && (
            <p className="empty" style={{ padding: 12 }}>
              No card matches. Try fewer words or another filter.
            </p>
          )}
        </div>
        <div className="pane__foot">
          <span>
            <kbd>f</kbd> filter
          </span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>/</kbd> search
          </span>
        </div>
      </div>
      {current ? (
        <Reader key={current} title={current} />
      ) : (
        <div className="empty-state">
          <h2>No cards yet</h2>
          <p>Ask your agent to keep something from a session, or drop a text file in the inbox.</p>
        </div>
      )}
    </div>
  );
}
