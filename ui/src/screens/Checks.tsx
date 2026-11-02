import { useCallback, useMemo, useState } from "react";
import { formatMoment, hashParams, post, useData, type Issue, type LogEntry } from "../api";
import { Reader } from "../components/Reader";
import { useListKeys } from "../components/useListKeys";
import { Button } from "../readout/Button";
import { ACTION, ISSUE } from "./Today";

const SEVERITY: Record<Issue["severity"], string> = { error: "Error", warning: "Warning", info: "Note" };
type Tab = "problems" | "rejected" | "log";

interface Rejected {
  file: string;
  title: string;
  at: string;
  summary: string;
}

const checksHref = (title: string) => `#/checks/${encodeURIComponent(title)}`;
/** Lint targets are card titles, or vault paths for files that are not cards. */
const isCard = (target?: string): target is string => !!target && !target.includes("/");

export function ChecksScreen({ title }: { title?: string }) {
  const { data: issues, stale } = useData<Issue[]>("/api/lint");
  const { data: log } = useData<LogEntry[]>("/api/log?limit=60");
  const { data: rejected } = useData<Rejected[]>("/api/rejected");
  const [tab, setTab] = useState<Tab>(() => {
    const t = hashParams().get("tab");
    return t === "rejected" || t === "log" ? t : "problems";
  });

  const groups = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const i of issues ?? []) m.set(i.code, [...(m.get(i.code) ?? []), i]);
    return [...m];
  }, [issues]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of issues ?? []) counts[i.severity]++;

  // The cards you can open from the current tab, in list order, for j / k and the default selection.
  const titles = useMemo(() => {
    const list =
      tab === "problems"
        ? groups.flatMap(([, items]) => items.map((i) => i.target)).filter(isCard)
        : tab === "log"
          ? (log ?? []).map((e) => e.title).filter(isCard)
          : [];
    return [...new Set(list)];
  }, [tab, groups, log]);
  const current = title ?? (tab === "problems" ? titles[0] : undefined);
  const go = useCallback((t: string) => location.replace(checksHref(t)), []);

  // Rejected cards are not in the wiki: they open read-only, selected by file name.
  const files = useMemo(() => (rejected ?? []).map((r) => r.file), [rejected]);
  const [file, setFile] = useState<string>();
  const currentFile = file && files.includes(file) ? file : files[0];
  const onRejected = tab === "rejected";
  useListKeys(onRejected ? files : titles, onRejected ? currentFile : current, onRejected ? setFile : go);
  const restore = useRestore();

  const selected = (t?: string) => !!t && t.toLowerCase() === current?.toLowerCase();

  return (
    <div className="split">
      <div className="pane">
        <div className="pane__head">
          <h1 className="pane__title">Checks</h1>
          <p className="pane__sub">
            {issues && !issues.length
              ? "No problems: links, sources and the index are consistent."
              : `${counts.error} ${counts.error === 1 ? "error" : "errors"} · ${counts.warning} ${counts.warning === 1 ? "warning" : "warnings"} · ${counts.info} ${counts.info === 1 ? "note" : "notes"}. Ask your agent “fix the Stet checks”.`}
          </p>
          <div className="ro-segmented pane__tabs" role="tablist" aria-label="Checks">
            {(
              [
                ["problems", "Problems", issues?.length],
                ["rejected", "Rejected", rejected?.length],
                ["log", "Log", undefined],
              ] as const
            ).map(([id, label, n]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} aria-pressed={tab === id} onClick={() => setTab(id)}>
                {label}
                {!!n && <span className="mono muted"> {n}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className={`pane__body ${stale ? "is-stale" : ""}`} role="listbox" aria-label={tab}>
          {tab === "problems" &&
            groups.map(([code, items]) => (
              <div key={code} className="pane__group">
                <div className="pane__group-head">
                  <span className="ro-eyebrow">
                    {ISSUE[code] ?? code} · {items.length}
                  </span>
                  <span className={`sev sev--${items[0].severity}`}>{SEVERITY[items[0].severity]}</span>
                </div>
                {items.map((i, n) =>
                  isCard(i.target) ? (
                    <a key={n} className="queue-item" role="option" aria-selected={selected(i.target)} href={checksHref(i.target)}>
                      <span className="queue-item__title">{i.target}</span>
                      <span className="queue-item__sub">{i.message}</span>
                    </a>
                  ) : (
                    <div key={n} className="queue-item queue-item--static">
                      <span className="queue-item__title mono" style={{ fontSize: 12.5 }}>
                        {i.target ?? "index.md"}
                      </span>
                      <span className="queue-item__sub">{i.message}</span>
                    </div>
                  ),
                )}
              </div>
            ))}
          {tab === "problems" && issues && !issues.length && <p className="empty pane__empty">Nothing to fix.</p>}

          {tab === "rejected" && <RejectedList items={rejected ?? []} selected={currentFile} onSelect={setFile} restore={restore} />}

          {tab === "log" &&
            (log ?? []).map((e, n) => {
              const body = (
                <>
                  <span className="queue-item__title">
                    {ACTION[e.action] ?? e.action}
                    {e.title ? ` · ${e.title}` : ""}
                  </span>
                  <span className="queue-item__meta">
                    <span>{e.session === "user" ? "You" : e.session ? "Your agent" : ""}</span>
                    <span className="mono">{formatMoment(e.at)}</span>
                  </span>
                  {e.detail && <span className="queue-item__sub">{e.detail}</span>}
                </>
              );
              return isCard(e.title) ? (
                <a key={n} className="queue-item" role="option" aria-selected={selected(e.title)} href={checksHref(e.title)}>
                  {body}
                </a>
              ) : (
                <div key={n} className="queue-item queue-item--static">
                  {body}
                </div>
              );
            })}
        </div>

        <div className="pane__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>v</kbd> validate
          </span>
          <span>
            <kbd>r</kbd> reject
          </span>
        </div>
      </div>

      {onRejected && currentFile ? (
        <RejectedReader key={currentFile} item={(rejected ?? []).find((r) => r.file === currentFile)!} restore={restore} />
      ) : !onRejected && current ? (
        <Reader key={current} title={current} />
      ) : (
        <div className="empty-state">
          <h2>{tab === "rejected" ? "Rejected cards" : issues && !issues.length ? "Nothing to fix" : "Pick a card"}</h2>
          <p>
            {tab === "rejected"
              ? "Cards you rejected stay in .stet/rejected/. Restore one to put it back in the wiki as a draft."
              : issues && !issues.length
                ? "Links, sources and the index are consistent."
                : "Select a problem or a log entry to read the card here."}
          </p>
        </div>
      )}
    </div>
  );
}

type Restore = ReturnType<typeof useRestore>;

/** Restore puts a rejected card back in the wiki as a draft, then opens it. */
function useRestore() {
  const [error, setError] = useState<{ file: string; message: string }>();
  const [busy, setBusy] = useState<string>();
  const run = async (r: Rejected) => {
    setBusy(r.file);
    const res = await post("/api/rejected/restore", { file: r.file });
    setBusy(undefined);
    if (res.ok) {
      setError(undefined);
      location.hash = checksHref(r.title);
    } else setError({ file: r.file, message: res.problems?.[0]?.message ?? "The card could not be restored." });
  };
  return { run, error, busy };
}

/** Cards you rejected, kept in .stet/rejected/. Click one to read it; Restore puts it back. */
function RejectedList({ items, selected, onSelect, restore }: { items: Rejected[]; selected?: string; onSelect: (file: string) => void; restore: Restore }) {
  if (!items.length) return <p className="empty pane__empty">No rejected card.</p>;
  return (
    <>
      {items.map((r) => (
        <div
          key={r.file}
          className="queue-item queue-item--row"
          role="option"
          tabIndex={0}
          aria-selected={r.file === selected}
          onClick={() => onSelect(r.file)}
          onKeyDown={(e) => e.key === "Enter" && onSelect(r.file)}
        >
          <span className="queue-item__main">
            <span className="queue-item__title">{r.title}</span>
            <span className="queue-item__sub">
              {restore.error?.file === r.file ? <span className="text-critical">{restore.error.message}</span> : r.summary}
            </span>
            <span className="queue-item__meta">
              <span className="mono">rejected {r.at ? formatMoment(r.at) : ""}</span>
            </span>
          </span>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              void restore.run(r);
            }}
            disabled={restore.busy === r.file}
          >
            Restore
          </Button>
        </div>
      ))}
    </>
  );
}

interface RejectedCard {
  title: string;
  tags: string[];
  sources: string[];
  created: string;
  updated: string;
  html: string;
}

/** A rejected card, read-only: what it said, and Restore. */
function RejectedReader({ item, restore }: { item: Rejected; restore: Restore }) {
  const { data, error } = useData<RejectedCard>(`/api/rejected/card?file=${encodeURIComponent(item.file)}`);
  if (error && !data)
    return (
      <div className="empty-state">
        <h2>Cannot read “{item.title}”</h2>
        <p>The file in .stet/rejected/ is missing or no longer a valid card.</p>
      </div>
    );
  if (!data) return <div className="reader" />;
  return (
    <div className="reader">
      <div className="reader__scroll">
        <article className="reader__inner">
          <div className="reader__eyebrow">
            <span className="status status--rejected">Rejected</span>
            <span>·</span>
            <span className="mono">{item.at ? formatMoment(item.at) : ""}</span>
          </div>
          <h1 className="reader__title">{data.title}</h1>
          <div className="reader__tags">
            {data.tags.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
          <p className="notice">Not in the wiki: links to it are broken and search does not find it. Restore it to bring it back as a draft.</p>
          <div className="prose" dangerouslySetInnerHTML={{ __html: data.html }} />
          <div className="meta-grid">
            <section className="meta-block">
              <h2 className="ro-eyebrow">Sources</h2>
              {data.sources.map((s) => (
                <div key={s} className="source-row">
                  <span className="source-row__ref mono" title={s}>
                    {s.replace(/^https?:\/\//, "").split("/").slice(-2).join("/")}
                  </span>
                </div>
              ))}
            </section>
            <section className="meta-block">
              <h2 className="ro-eyebrow">File</h2>
              <p className="mono" style={{ margin: 0, fontSize: 12.5, overflowWrap: "anywhere", color: "var(--ink-secondary)" }}>
                .stet/rejected/{item.file}
              </p>
            </section>
          </div>
        </article>
      </div>
      <div className="actionbar">
        <div className="actionbar__hint">{restore.error?.file === item.file && <span className="text-critical">{restore.error.message}</span>}</div>
        <Button variant="primary" onClick={() => void restore.run(item)} disabled={restore.busy === item.file}>
          Restore as a draft
        </Button>
      </div>
    </div>
  );
}
