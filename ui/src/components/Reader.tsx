import { diffWords } from "./diff";
import { MarkdownEditor } from "./MarkdownEditor";
import { MetaPickers } from "./Meta";
import { useCallback, useEffect, useRef, useState } from "react";
import { ago, bump, cardHref, formatDay, formatMoment, get, post, useData, type CardDetail } from "../api";
import { Button } from "../readout/Button";
import { InfoTip } from "../readout/InfoTip";
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
 * One card, set for reading, with its review actions. `onDone` runs after a validate or a reject so the
 * caller can move to the next draft. Keyboard: v validate, r reject (when `keys` is on).
 */
export function Reader({ title, onDone, keys = true }: { title: string; onDone?: (title: string) => void; keys?: boolean }) {
  const { data, error, stale } = useData<CardDetail>(`/api/card?title=${encodeURIComponent(title)}`);
  const [problems, setProblems] = useState<Problems>();
  const [confirmReject, setConfirmReject] = useState(false);
  // A card the agent changed after you validated it opens on the changes.
  const [showDiff, setShowDiff] = useState(true);
  const [source, setSource] = useState<string>();
  const [tags, setTags] = useState<string>();
  // Edit mode: the text being written, and the text it started from (to refuse saving over a newer change).
  const [draft, setDraft] = useState<{ text: string; base: string }>();
  const busy = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProblems(undefined);
    setTags(undefined);
    setDraft(undefined);
    setShowDiff(true);
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

  // Acts on the card on screen, once: never on a stale render, never twice in a row.
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
        if (await act("/api/card/status", { title: data!.title, status: "validated" })) onDone?.(data!.title);
      }),
    [guarded, act, data, onDone],
  );

  const reject = useCallback(
    () =>
      guarded(async () => {
        if (await act("/api/card/reject", { title: data!.title })) {
          setConfirmReject(false);
          onDone?.(data!.title);
        }
      }),
    [guarded, act, data, onDone],
  );

  useEffect(() => {
    if (!keys) return;
    const on = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || confirmReject || source || tags !== undefined || draft) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "v") void validate();
      if (e.key === "r" && data) setConfirmReject(true);
      if (e.key === "d" && data?.previous) setShowDiff((d) => !d);
      if (e.key === "e" && data) {
        e.preventDefault();
        setDraft({ text: data.body, base: data.body });
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [keys, validate, data, confirmReject, source, tags, draft]);

  const save = useCallback(async () => {
    if (!data || !draft || busy.current) return;
    busy.current = true;
    try {
      if (await act("/api/card/body", { title: data.title, body: draft.text, base: draft.base })) setDraft(undefined);
    } finally {
      busy.current = false;
    }
  }, [act, data, draft]);

  if (error && !data)
    return (
      <div className="empty-state">
        <h2>No card titled “{title}”</h2>
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
            {draft && <span className="badge badge--accent">Editing</span>}
            <span>·</span>
            <span>{ORIGIN[data.origin]}</span>
            <span>·</span>
            <span className="mono">updated {formatDay(data.updated)}</span>
            {data.reuses > 0 && (
              <>
                <span>·</span>
                <span className="mono">recalled {data.reuses}×</span>
              </>
            )}
          </div>
          <h1 className="reader__title">{data.title}</h1>
          <div className="reader__tags">
            <MetaPickers
              title={data.title}
              kind={data.kind}
              project={data.project}
              onProblem={(message) => setProblems([{ field: "", message }])}
            />
            <span className="reader__sep" aria-hidden />
            {tags === undefined ? (
              <>
                {data.tags.map((t) => (
                  <a key={t} className="tag" href={`#/cards?tag=${encodeURIComponent(t)}`}>
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
                  void act("/api/card/tags", { title: data.title, tags: tags.split(",") }).then((ok) => ok && setTags(undefined));
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

          {(data.revalidation || data.previous) && (
            <div className="notice notice--split">
              <span>You had validated this card. Your agent changed it since; check the text again.</span>
              {data.previous && (
                <button className="link-button" onClick={() => setShowDiff((d) => !d)} aria-pressed={showDiff}>
                  {showDiff ? "Show the card" : "Show changes"} {keys && <kbd>d</kbd>}
                </button>
              )}
            </div>
          )}
          {problems && (
            <ul className="problems">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}

          {draft ? (
            <div className="editor">
              <MarkdownEditor
                value={draft.base}
                onChange={(text) => setDraft((d) => d && { ...d, text })}
                onSave={() => void save()}
                onCancel={() => setDraft((d) => (d && d.text !== d.base ? d : undefined))}
              />
              <p className="editor__hint">
                Editing the markdown. Link a card with <code className="mono">[[Its title]]</code>. <kbd>⌘S</kbd> saves,{" "}
                <kbd>esc</kbd> leaves when nothing changed.
              </p>
            </div>
          ) : showDiff && data.previous ? (
            <Changes before={data.previous} after={data} />
          ) : (
            <div className="prose" dangerouslySetInnerHTML={{ __html: data.html }} />
          )}

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
                    <a className="source-row__ref" style={{ fontFamily: "var(--font-sans)", fontSize: 13 }} href={cardHref(b)}>
                      {b}
                    </a>
                  </div>
                ))
              ) : (
                <p className="empty" style={{ fontSize: 13 }}>
                  No card links here yet.
                </p>
              )}
            </section>
            <section className="meta-block meta-block--wide">
              <div className="section__title">
                <h2 className="ro-eyebrow">Recalled by your agent</h2>
                <InfoTip text="Later sessions where your agent searched or read this card: the project it worked in, and what it was looking for." />
              </div>
              {data.recalls.length ? (
                <ul className="recalls">
                  {data.recalls.map((r) => (
                    <li key={`${r.session}-${r.at}`}>
                      <span className="recalls__what">{r.query ? <>“{r.query}”</> : <span className="muted">no search recorded</span>}</span>
                      <span className="recalls__where mono">
                        {r.project ?? "a session"} · {formatMoment(r.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty" style={{ margin: 0 }}>
                  Not yet. When your agent pulls this card into a later session, it shows here.
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
                Created {ago(data.created)}. To change the text, use Edit or ask your agent.
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
        {draft ? (
          <>
            <Button
              onClick={() => {
                setDraft(undefined);
                setProblems(undefined);
              }}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void save()} disabled={draft.text === draft.base}>
              Save <kbd>⌘S</kbd>
            </Button>
          </>
        ) : (
          <>
        <Button onClick={() => setDraft({ text: data.body, base: data.body })}>
          Edit {keys && <kbd>e</kbd>}
        </Button>
        <Button onClick={() => setConfirmReject(true)}>
          Reject {keys && <kbd>r</kbd>}
        </Button>
        {data.status === "draft" ? (
          <Button variant="primary" onClick={() => void validate()}>
            Validate {keys && <kbd>v</kbd>}
          </Button>
        ) : (
          <Button onClick={() => void act("/api/card/status", { title: data.title, status: "draft" })}>Back to review</Button>
        )}
          </>
        )}
      </div>

      {confirmReject && (
        <Dialog title="Reject this card?" onClose={() => setConfirmReject(false)}>
          <p style={{ margin: 0 }}>
            “{data.title}” leaves the wiki and moves to <code className="mono">.stet/rejected/</code>; you can restore it from Checks. Its
            sources stay in place.
          </p>
          {data.backlinks.length > 0 && (
            <div className="reject-links">
              <p style={{ margin: 0 }}>
                {data.backlinks.length === 1 ? "This card links to it" : `These ${data.backlinks.length} cards link to it`}; the
                {data.backlinks.length === 1 ? " link" : " links"} will break and show up in Checks until you or your agent fix them:
              </p>
              <ul>
                {data.backlinks.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="ro-actions">
            <Button autoFocus onClick={() => setConfirmReject(false)}>
              Cancel
            </Button>
            <Button variant="critical" onClick={() => void reject()}>
              Reject the card
            </Button>
          </div>
        </Dialog>
      )}
      {source && <SourceDialog path={source} onClose={() => setSource(undefined)} />}
    </div>
  );
}

/** What the agent changed since you validated: title, tags and text, word by word. */
function Changes({ before, after }: { before: { title: string; body: string; tags: string[] }; after: { title: string; body: string; tags: string[] } }) {
  const parts = diffWords(before.body, after.body);
  const tagsBefore = before.tags.join(", ");
  const tagsAfter = after.tags.join(", ");
  const changed = parts.some((p) => p.kind !== "same");
  return (
    <div className="changes">
      {before.title !== after.title && (
        <p className="changes__meta">
          Title: <del>{before.title}</del> → <ins>{after.title}</ins>
        </p>
      )}
      {tagsBefore !== tagsAfter && (
        <p className="changes__meta">
          Tags: <del>{tagsBefore}</del> → <ins>{tagsAfter}</ins>
        </p>
      )}
      {changed ? (
        <pre className="changes__text">
          {parts.map((p, i) =>
            p.kind === "same" ? <span key={i}>{p.text}</span> : p.kind === "added" ? <ins key={i}>{p.text}</ins> : <del key={i}>{p.text}</del>,
          )}
        </pre>
      ) : (
        <p className="changes__meta">The text is the same; only the metadata changed.</p>
      )}
    </div>
  );
}
