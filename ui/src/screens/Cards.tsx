import { useEffect, useMemo, useRef, useState } from "react";
import { ficheHref, formatDay, hashParams, useData, type Hit } from "../api";
import { Reader, Status } from "../components/Reader";

export function WikiScreen({ title }: { title?: string }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [tag, setTag] = useState(() => hashParams().get("tag") ?? "");
  const [status, setStatus] = useState("");
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
  const { data, stale } = useData<Hit[]>(`/api/search?${params}`);
  const { data: tags } = useData<{ tag: string; count: number }[]>("/api/tags");

  const hits = useMemo(() => {
    const list = [...(data ?? [])];
    if (!debounced.trim()) list.sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [data, debounced]);

  const current = title ?? hits[0]?.title;
  const index = hits.findIndex((h) => h.title.toLowerCase() === current?.toLowerCase());

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if (e.key === "j" && hits[index + 1]) location.replace(ficheHref(hits[index + 1].title));
      if (e.key === "k" && index > 0) location.replace(ficheHref(hits[index - 1].title));
      if (e.key === "f") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [hits, index]);

  return (
    <div className="split">
      <div className="pane">
        <div className="pane__head">
          <h1 className="pane__title">
            Wiki <span className="mono muted" style={{ fontSize: 12, fontWeight: 400 }}>{hits.length} {hits.length === 1 ? "fiche" : "fiches"}</span>
          </h1>
          <input
            ref={input}
            className="filter-input"
            type="search"
            placeholder="Filter by words"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Filter fiches by words"
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
          {!!tags?.length && (
            <div className="filter-row" role="group" aria-label="Tags">
              {tags.slice(0, 10).map((t) => (
                <button key={t.tag} className="tag" aria-pressed={tag === t.tag} onClick={() => setTag(tag === t.tag ? "" : t.tag)}>
                  {t.tag} <span style={{ opacity: 0.6, marginLeft: 4 }}>{t.count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={`pane__body ${stale ? "is-stale" : ""}`} role="listbox" aria-label="Fiches">
          {hits.map((h) => (
            <a
              key={h.title}
              className="queue-item"
              role="option"
              aria-selected={h.title.toLowerCase() === current?.toLowerCase()}
              href={ficheHref(h.title)}
            >
              <span className="queue-item__title">{h.title}</span>
              {h.excerpt && <span className="queue-item__sub">{h.excerpt}</span>}
              <span className="queue-item__meta">
                <Status status={h.status} />
                {h.updated && <span className="mono">{formatDay(h.updated)}</span>}
              </span>
            </a>
          ))}
          {data && !hits.length && (
            <p className="empty" style={{ padding: 12 }}>
              No fiche matches. Try fewer words or another filter.
            </p>
          )}
        </div>
        <div className="pane__foot">
          <span>
            <kbd>f</kbd> filter
          </span>
          <span>
            <kbd>j</kbd>
            <kbd>k</kbd> move
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
          <h2>No fiches yet</h2>
          <p>Ask your agent to keep something from a session, or drop a text file in the inbox.</p>
        </div>
      )}
    </div>
  );
}
