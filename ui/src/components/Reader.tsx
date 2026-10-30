import { useCallback, useEffect, useRef, useState } from "react";
import { ago, bump, ficheHref, formatDay, formatMoment, get, post, useData, type FicheDetail } from "../api";
import { Button } from "../readout/Button";
import { Dialog } from "./Dialog";
import { ACTION } from "../screens/Today";

type Problems = { field: string; message: string }[];

const ORIGIN: Record<string, string> = { session: "From a session", import: "From the inbox", link: "From a link" };
const KIND: Record<string, string> = { session: "session note", import: "import", url: "link", file: "file" };

export function Status({ status }: { status: string }) {
  return <span className={`status status--${status}`}>{status === "draft" ? "To review" : "Validated"}</span>;
}

function SourceDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [content, setContent] = useState<string>();
  useEffect(() => {
    get<{ content: string }>(`/api/source?path=${encodeURIComponent(path)}`)
      .then((r) => setContent(r.content))
      .catch(() => setContent("This source could not be read."));
  }, [path]);
  return (
    <Dialog title={path.split("/").pop() ?? path} onClose={onClose}>
      <p className="mono muted" style={{ margin: 0, fontSize: 12 }}>
        {path}
      </p>
      <pre className="source-view">{content ?? "Loading…"}</pre>
    </Dialog>
  );
}

/**
 * One fiche, set for reading, with its review actions. `onDone` runs after a validate or a reject so the
 * caller can move to the next draft. Keyboard: v validate, r reject (when `keys` is on).
 */
export function Reader({ title, onDone, keys = true }: { title: string; onDone?: (title: string) => void; keys?: boolean }) {
  const { data, error, stale } = useData<FicheDetail>(`/api/fiche?title=${encodeURIComponent(title)}`);
  const [problems, setProblems] = useState<Problems>();
  const [confirmReject, setConfirmReject] = useState(false);
  const [source, setSource] = useState<string>();
  const [tags, setTags] = useState<string>();
  const busy = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProblems(undefined);
    setTags(undefined);
    scroller.current?.scrollTo(0, 0);
  }, [title]);

  const act = useCallback(async (url: string, body: unknown) => {
    const r = await post(url, body);
    if (!r.ok) {
      setProblems(r.problems ?? [{ field: "", message: "The change was refused." }]);
      return false;
    }
    setProblems(undefined);
    bump();
    return true;
  }, []);

  // Acts on the fiche on screen, once: never on a stale render, never twice in a row.
  const guarded = useCallback(
    async (fn: () => Promise<void>) => {
      if (!data || stale || busy.current) return;
      busy.current = true;
      try {
        await fn();
      } finally {
        setTimeout(() => (busy.current = false), 400);
      }
    },
    [data, stale],
  );

  const validate = useCallback(
    () =>
      guarded(async () => {
        if (data!.status !== "draft") return;
        if (await act("/api/fiche/status", { title: data!.title, status: "validated" })) onDone?.(data!.title);
      }),
    [guarded, act, data, onDone],
  );

  const reject = useCallback(
    () =>
      guarded(async () => {
        if (await act("/api/fiche/reject", { title: data!.title })) {
          setConfirmReject(false);
          onDone?.(data!.title);
        }
      }),
    [guarded, act, data, onDone],
  );

  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || confirmReject || source || tags !== undefined) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "v") void validate();
      if (e.key === "r" && data) setConfirmReject(true);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [keys, validate, data, confirmReject, source, tags]);

  if (error && !data)
    return (
      <div className="empty-state">
        <h2>No fiche titled “{title}”</h2>
        <p>It may have been renamed or rejected.</p>
      </div>
    );
  if (!data) return <div className="reader" />;

  const sessionNote = data.sources.find((s) => s.kind === "session" || s.kind === "import");

  return (
    <div className={`reader ${stale ? "is-stale" : ""}`}>
      <div className="reader__scroll" ref={scroller}>
        <article className="reader__inner">
          <div className="reader__eyebrow">
            <Status status={data.status} />
            <span>·</span>
            <span>{ORIGIN[data.origin]}</span>
            <span>·</span>
            <span className="mono">updated {formatDay(data.updated)}</span>
            {data.reuses > 0 && (
              <>
                <span>·</span>
                <span className="mono">reused {data.reuses}×</span>
              </>
            )}
          </div>
          <h1 className="reader__title">{data.title}</h1>
          <div className="reader__tags">
            {tags === undefined ? (
              <>
                {data.tags.map((t) => (
                  <a key={t} className="tag" href={`#/wiki?tag=${encodeURIComponent(t)}`}>
                    {t}
                  </a>
                ))}
                <button className="link-button" onClick={() => setTags(data.tags.join(", "))}>
                  Edit tags
                </button>
              </>
            ) : (
              <form
                style={{ display: "flex", gap: 6 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("/api/fiche/tags", { title: data.title, tags: tags.split(",") }).then((ok) => ok && setTags(undefined));
                }}
              >
                <input
                  className="tag-input"
                  autoFocus
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setTags(undefined)}
                  aria-label="Tags, comma-separated"
                />
                <button className="link-button" type="submit">
                  Save
                </button>
              </form>
            )}
          </div>

          {data.revalidation && (
            <p className="notice">You had validated this fiche. Your agent changed it since; check the text again.</p>
          )}
          {problems && (
            <ul className="problems">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}

          <div className="prose" dangerouslySetInnerHTML={{ __html: data.html }} />

          <div className="meta-grid">
            <section className="meta-block">
              <h2 className="ro-eyebrow">Sources</h2>
              {data.sources.map((s) => (
                <div key={s.ref} className="source-row">
                  {s.kind === "url" ? (
                    <a className="source-row__ref" href={s.ref} target="_blank" rel="noreferrer noopener" title={s.ref}>
                      {s.ref.replace(/^https?:\/\//, "")}
                    </a>
                  ) : (
                    <button className="source-row__ref" onClick={() => setSource(s.ref)} title={s.ref}>
                      {s.ref.split("/").pop()}
                    </button>
                  )}
                  <span className="badge">{s.ok ? KIND[s.kind] : "missing"}</span>
                </div>
              ))}
            </section>
            <section className="meta-block">
              <h2 className="ro-eyebrow">Links here</h2>
              {data.backlinks.length ? (
                data.backlinks.map((b) => (
                  <div key={b} className="source-row">
                    <a className="source-row__ref" style={{ fontFamily: "var(--font-sans)", fontSize: 13 }} href={ficheHref(b)}>
                      {b}
                    </a>
                  </div>
                ))
              ) : (
                <p className="empty" style={{ fontSize: 13 }}>
                  No fiche links here yet.
                </p>
              )}
            </section>
            <section className="meta-block">
              <h2 className="ro-eyebrow">History</h2>
              <ul className="history">
                {data.history.slice(0, 6).map((h, i) => (
                  <li key={i}>
                    <span>
                      {ACTION[h.action] ?? h.action}
                      {h.session === "user" ? " by you" : h.session ? " by your agent" : ""}
                    </span>
                    <span className="mono">{formatMoment(h.at)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="meta-block">
              <h2 className="ro-eyebrow">File</h2>
              <p className="mono muted" style={{ margin: 0, fontSize: 12, overflowWrap: "anywhere" }}>
                {data.path}
              </p>
              <p className="empty" style={{ fontSize: 12.5, marginTop: 8 }}>
                Created {ago(data.created)}. To change the text, ask your agent or edit the file.
              </p>
            </section>
          </div>
        </article>
      </div>

      <div className="actionbar">
        <div className="actionbar__hint">
          {sessionNote && (
            <button className="link-button" style={{ padding: 0 }} onClick={() => setSource(sessionNote.ref)}>
              Open the {sessionNote.kind === "session" ? "session note" : "imported file"}
            </button>
          )}
        </div>
        <Button onClick={() => setConfirmReject(true)}>
          Reject {keys && <kbd>r</kbd>}
        </Button>
        {data.status === "draft" ? (
          <Button variant="primary" onClick={() => void validate()}>
            Validate {keys && <kbd>v</kbd>}
          </Button>
        ) : (
          <Button onClick={() => void act("/api/fiche/status", { title: data.title, status: "draft" })}>Back to review</Button>
        )}
      </div>

      {confirmReject && (
        <Dialog title="Reject this fiche?" onClose={() => setConfirmReject(false)}>
          <p style={{ margin: 0 }}>
            “{data.title}” leaves the wiki and moves to <code className="mono">.stet/rejected/</code>, where you can recover it. Its
            sources stay in place.
          </p>
          <div className="ro-actions">
            <Button autoFocus onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button variant="critical" onClick={() => void reject()}>
              Reject the fiche
            </Button>
          </div>
        </Dialog>
      )}
      {source && <SourceDialog path={source} onClose={() => setSource(undefined)} />}
    </div>
  );
}
