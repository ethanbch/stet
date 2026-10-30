import { useCallback, useEffect, useState } from "react";
import { bump, ficheHref, formatDay, formatMoment, get, post, useData, type FicheDetail, type Home } from "../api";
import { Button } from "../readout/Button";
import { Card } from "../readout/Card";
import { Status } from "./Home";

type Problems = { field: string; message: string }[];

async function nextDraft(current: string): Promise<string | undefined> {
  const home = await get<Home>("/api/home");
  const drafts = home.drafts.map((d) => d.title).filter((t) => t !== current);
  return drafts[0];
}

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [onClose]);
  return (
    <div className="ro-scrim" onClick={onClose}>
      <div className="ro-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ro-dialog__head">
          <h2 className="ro-dialog__title">{title}</h2>
          <button className="ro-icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ro-dialog__body">{children}</div>
      </div>
    </div>
  );
}

function SourceDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [content, setContent] = useState<string>();
  useEffect(() => {
    get<{ content: string }>(`/api/source?path=${encodeURIComponent(path)}`)
      .then((r) => setContent(r.content))
      .catch(() => setContent("This source could not be read."));
  }, [path]);
  return (
    <Dialog title={path} onClose={onClose}>
      <pre className="source-view">{content ?? "Loading…"}</pre>
    </Dialog>
  );
}

export function FicheScreen({ title }: { title: string }) {
  const { data, error, stale } = useData<FicheDetail>(`/api/fiche?title=${encodeURIComponent(title)}`);
  const [problems, setProblems] = useState<Problems>();
  const [confirmReject, setConfirmReject] = useState(false);
  const [source, setSource] = useState<string>();
  const [editTags, setEditTags] = useState<string>();

  useEffect(() => {
    setProblems(undefined);
    setEditTags(undefined);
    scrollTo(0, 0);
  }, [title]);

  const act = useCallback(
    async (url: string, body: unknown, after?: () => Promise<void> | void) => {
      const r = await post(url, body);
      if (!r.ok) return setProblems(r.problems ?? [{ field: "", message: "the change was refused" }]);
      setProblems(undefined);
      bump();
      await after?.();
    },
    [],
  );

  const validateAndNext = useCallback(async () => {
    if (!data || data.status !== "draft") return;
    await act("/api/fiche/status", { title: data.title, status: "validated" }, async () => {
      const next = await nextDraft(data.title);
      if (next) location.hash = ficheHref(next);
    });
  }, [data, act]);

  const goNext = useCallback(async () => {
    if (!data) return;
    const next = await nextDraft(data.title);
    if (next) location.hash = ficheHref(next);
  }, [data]);

  // One key to validate: v validates and opens the next draft, n skips to it.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || confirmReject || source || editTags !== undefined) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "v") void validateAndNext();
      if (e.key === "n") void goNext();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [validateAndNext, goNext, confirmReject, source, editTags]);

  if (error && !data) return <p className="empty">No fiche titled “{title}”. It may have been renamed or rejected.</p>;
  if (!data) return null;

  return (
    <div className={stale ? "is-stale" : undefined}>
      <a className="back" href="#/">
        ← Overview
      </a>
      <div className="grid grid--main-side">
        <Card>
          <div className="fiche-head">
            <div>
              <h1 className="fiche-title">{data.title}</h1>
              <div className="fiche-meta">
                <Status status={data.status} />
                <span className="mono">created {formatDay(data.created)}</span>
                <span className="mono">updated {formatDay(data.updated)}</span>
                {data.reuses > 0 && <span className="mono">reused {data.reuses}×</span>}
              </div>
            </div>
            <div className="ro-actions">
              <Button onClick={() => setConfirmReject(true)}>Reject</Button>
              {data.status === "draft" ? (
                <Button variant="primary" onClick={() => void validateAndNext()} title="Shortcut: v">
                  Validate <span className="kbd" style={{ color: "inherit", borderColor: "currentColor" }}>v</span>
                </Button>
              ) : (
                <Button onClick={() => void act("/api/fiche/status", { title: data.title, status: "draft" })}>Back to review</Button>
              )}
            </div>
          </div>
          {problems && (
            <ul className="problems">
              {problems.map((p, i) => (
                <li key={i}>{p.message}</li>
              ))}
            </ul>
          )}
          <div className="prose" dangerouslySetInnerHTML={{ __html: data.html }} />
          {data.status === "draft" && (
            <p className="hint">
              <span className="kbd">v</span> validate and open the next draft · <span className="kbd">n</span> next draft. The text is
              written by your agent: ask it for changes, or edit <code>{data.path}</code> in your editor.
            </p>
          )}
        </Card>

        <div className="stack">
          <Card title="Tags" action={editTags === undefined && <button className="ro-link" onClick={() => setEditTags(data.tags.join(", "))}>Edit</button>}>
            {editTags === undefined ? (
              <span className="tags">
                {data.tags.map((t) => (
                  <a key={t} className="ro-pill" href={`#/search?tag=${encodeURIComponent(t)}`} style={{ textDecoration: "none" }}>
                    {t}
                  </a>
                ))}
              </span>
            ) : (
              <form
                className="tag-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act("/api/fiche/tags", { title: data.title, tags: editTags.split(",") }, () => setEditTags(undefined));
                }}
              >
                <input className="input" style={{ flex: 1 }} autoFocus value={editTags} onChange={(e) => setEditTags(e.target.value)} aria-label="Tags, comma-separated" />
                <Button type="submit">Save</Button>
              </form>
            )}
          </Card>

          <Card title="Sources" info="Session notes are written by the agent; imports are files from your inbox; links point outside.">
            <ul className="rows">
              {data.sources.map((s) => (
                <li key={s.ref} className="source">
                  {s.kind === "url" ? (
                    <a className="source__ref" href={s.ref} target="_blank" rel="noreferrer noopener">
                      {s.ref}
                    </a>
                  ) : (
                    <button className="source__ref" onClick={() => setSource(s.ref)} title={s.ref}>
                      {s.ref.split("/").pop()}
                    </button>
                  )}
                  <span className="source__kind">
                    {!s.ok ? "missing" : s.kind === "session" ? "session note" : s.kind === "import" ? "import" : s.kind === "url" ? "link" : "file"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="Links here">
            {data.backlinks.length ? (
              <ul className="rows">
                {data.backlinks.map((b) => (
                  <li key={b}>
                    <a className="row" href={ficheHref(b)}>
                      <span className="row__title">{b}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No fiche links here yet.</p>
            )}
          </Card>

          <Card title="History">
            <ul className="rows">
              {data.history.slice(0, 8).map((h, i) => (
                <li key={i} className="row">
                  <span className="row__title">{h.action}</span>
                  <span className="row__meta">{formatMoment(h.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
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
            <Button
              variant="critical"
              onClick={() =>
                void act("/api/fiche/reject", { title: data.title }, async () => {
                  setConfirmReject(false);
                  const next = await nextDraft(data.title);
                  location.hash = next ? ficheHref(next) : "#/";
                })
              }
            >
              Reject the fiche
            </Button>
          </div>
        </Dialog>
      )}
      {source && <SourceDialog path={source} onClose={() => setSource(undefined)} />}
    </div>
  );
}
