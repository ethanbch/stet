import { useCallback, useEffect, useMemo, useRef } from "react";
import { ago, reviewHref, useData, type FicheRow } from "../api";
import { Reader } from "../components/Reader";

const ORIGIN: Record<string, string> = { session: "session", import: "inbox", link: "link" };

export function ReviewScreen({ title }: { title?: string }) {
  const { data } = useData<FicheRow[]>("/api/fiches");
  const queue = useMemo(
    () => (data ?? []).filter((f) => f.status === "draft").sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title)),
    [data],
  );
  const current = queue.find((f) => f.title.toLowerCase() === title?.toLowerCase()) ?? queue[0];
  const index = current ? queue.indexOf(current) : -1;
  const list = useRef<HTMLDivElement>(null);
  // The queue as it was when an action started, so "next" is computed before the fiche leaves it.
  const snapshot = useRef<FicheRow[]>([]);
  snapshot.current = queue;

  const go = useCallback((t: string) => location.replace(reviewHref(t)), []);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [role=dialog]")) return;
      if ((e.key === "j" || e.key === "ArrowDown") && queue[index + 1]) {
        e.preventDefault();
        go(queue[index + 1].title);
      }
      if ((e.key === "k" || e.key === "ArrowUp") && index > 0) {
        e.preventDefault();
        go(queue[index - 1].title);
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [queue, index, go]);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current?.title]);

  const onDone = useCallback(
    (done: string) => {
      const q = snapshot.current;
      const i = q.findIndex((f) => f.title === done);
      const next = q[i + 1] ?? q[i - 1];
      if (next && next.title !== done) go(next.title);
      else location.replace("#/review");
    },
    [go],
  );

  if (data && !queue.length)
    return (
      <div className="empty-state">
        <h2>Nothing to review</h2>
        <p>
          When your agent keeps something from a session or processes the inbox, the draft appears here. Validate it with <kbd>v</kbd>,
          reject it with <kbd>r</kbd>.
        </p>
        <a className="ro-link" href="#/wiki">
          Browse the wiki →
        </a>
      </div>
    );

  return (
    <div className="split">
      <div className="pane">
        <div className="pane__head">
          <h1 className="pane__title">
            Review <span className="mono muted" style={{ fontSize: 12, fontWeight: 400 }}>{index + 1} of {queue.length}</span>
          </h1>
        </div>
        <div className="pane__body" ref={list} role="listbox" aria-label="Drafts to review">
          {queue.map((f) => (
            <button
              key={f.title}
              className="queue-item"
              role="option"
              aria-selected={f.title === current?.title}
              onClick={() => go(f.title)}
            >
              <span className="queue-item__title">{f.title}</span>
              {f.summary && <span className="queue-item__sub">{f.summary}</span>}
              <span className="queue-item__meta">
                <span className="badge">{ORIGIN[f.origin]}</span>
                <span className="mono">{ago(f.updated)}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="pane__foot">
          <span>
            <kbd>j</kbd>
            <kbd>k</kbd> move
          </span>
          <span>
            <kbd>v</kbd> validate
          </span>
          <span>
            <kbd>r</kbd> reject
          </span>
        </div>
      </div>
      {current ? <Reader key={current.title} title={current.title} onDone={onDone} /> : <div />}
    </div>
  );
}
