import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ago, get, post, useData, bump, type CardRow } from "../api";
import { Reader } from "../components/Reader";
import { IconAgent, IconArrow, IconCard, IconFile, IconWiki } from "../components/icons";
import { Button } from "../readout/Button";
import { openInbox, INBOX_TYPES } from "../components/Inbox";
import { useListKeys } from "../components/useListKeys";
import { CopyLine } from "./Setup";

interface Waiting {
  name: string;
  size: number;
  mtime: string;
  supported: boolean;
}

const kb = (n: number) => (n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
const inboxHref = (id: string) => `#/inbox/${encodeURIComponent(id)}`;
// Drafts and waiting files share one list: files carry a prefix, drafts are their title.
const FILE = "file:";

const ORIGIN: Record<string, string> = { session: "session", import: "inbox", link: "link" };

/**
 * Everything new, in one place. Drafts your agent wrote wait for you on top; files you added wait for
 * your agent (it processes them at the start of your next session). A processed file is the source of its cards, in the wiki.
 */
export function InboxScreen({ id }: { id?: string }) {
  const { data, stale } = useData<{ waiting: Waiting[] }>("/api/inbox");
  const { data: cards } = useData<CardRow[]>("/api/cards");
  const drafts = useMemo(
    () => (cards ?? []).filter((f) => f.status === "draft").sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title)),
    [cards],
  );
  const waiting = data?.waiting ?? [];
  const ids = useMemo(
    () => [...waiting.map((w) => FILE + w.name), ...drafts.map((d) => d.title)],
    [drafts, waiting],
  );
  // Open on what waits for you first: the newest draft, else the first file.
  const current =
    id && ids.some((x) => x.toLowerCase() === id.toLowerCase()) ? ids.find((x) => x.toLowerCase() === id.toLowerCase()) : (drafts[0]?.title ?? ids[0]);
  const go = useCallback((x: string) => location.replace(inboxHref(x)), []);
  useListKeys(ids, current, go);

  // The drafts as they were when an action started, so "next" is computed before the card leaves the list.
  const snapshot = useRef<CardRow[]>([]);
  snapshot.current = drafts;
  const onDone = useCallback(
    (done: string) => {
      const q = snapshot.current;
      const i = q.findIndex((f) => f.title === done);
      const next = q[i + 1] ?? q[i - 1];
      if (next && next.title !== done) go(next.title);
      else location.replace("#/inbox");
    },
    [go],
  );

  const draft = drafts.find((d) => d.title === current);
  const w = current?.startsWith(FILE) ? waiting.find((x) => FILE + x.name === current) : undefined;
  const empty = data && cards && !ids.length;

  return (
    <div className="split">
      <div className="pane">
        <div className="pane__head">
          <h1 className="pane__title">
            Inbox
            <Button onClick={openInbox}>Add</Button>
          </h1>
          <ol className="pipeline" aria-label="How things move: files go to your agent, its drafts come to you, what you validate joins your cards">
            <li title="Files you added, waiting for your agent">
              <IconFile />
              <span className="mono">{waiting.length}</span>
            </li>
            <li className="pipeline__arrow" aria-hidden>
              <IconArrow />
            </li>
            <li title="Your agent turns them into drafts" className="pipeline__agent">
              <IconAgent />
            </li>
            <li className="pipeline__arrow" aria-hidden>
              <IconArrow />
            </li>
            <li title="Drafts waiting for you" className="pipeline__you">
              <IconCard />
              <span className="mono">{drafts.length}</span>
            </li>
            <li className="pipeline__arrow" aria-hidden>
              <IconArrow />
            </li>
            <li title="What you validated">
              <IconWiki />
              <span>Cards</span>
            </li>
          </ol>
        </div>
        <div className={`pane__body ${stale ? "is-stale" : ""}`} role="listbox" aria-label="Inbox">
          {waiting.length > 0 && (
            <div className="pane__group">
              <div className="pane__group-head">
                <span className="ro-eyebrow owner">
                  <IconAgent /> For your agent · {waiting.length}
                </span>
              </div>
              {waiting.map((x) => (
                <a key={x.name} className="queue-item queue-item--file" role="option" aria-selected={current === FILE + x.name} href={inboxHref(FILE + x.name)}>
                  <span className="queue-item__title">
                    <IconFile /> {x.name}
                  </span>
                  <span className="queue-item__meta">
                    <span className={`status ${x.supported ? "status--agent" : "status--rejected"}`}>{x.supported ? "Next session" : "Not a text file"}</span>
                    <span className="mono">
                      {kb(x.size)} · {ago(x.mtime)}
                    </span>
                  </span>
                </a>
              ))}
            </div>
          )}
          <div className="pane__group">
            <div className="pane__group-head">
              <span className="ro-eyebrow owner owner--you">
                <i className="owner__dot" /> For you · {drafts.length}
              </span>
            </div>
            {drafts.map((f) => (
              <a key={f.title} className="queue-item" role="option" aria-selected={current === f.title} href={inboxHref(f.title)}>
                <span className="queue-item__title">{f.title}</span>
                {f.summary && <span className="queue-item__sub">{f.summary}</span>}
                <span className="queue-item__meta">
                  {f.kind && <span className="badge">{f.kind}</span>}
                  {f.project && <span className="badge badge--project">{f.project}</span>}
                  <span>{ORIGIN[f.origin]}</span>
                  <span className="mono">{ago(f.updated)}</span>
                </span>
              </a>
            ))}
            {cards && !drafts.length && <p className="empty pane__empty">Nothing waits for you.</p>}
          </div>
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
          <span>
            <kbd>e</kbd> edit
          </span>
        </div>
      </div>

      {draft ? (
        <Reader key={draft.title} title={draft.title} onDone={onDone} />
      ) : w ? (
        <WaitingFile key={w.name} item={w} />
      ) : empty ? (
        <InboxEmpty />
      ) : (
        <div />
      )}
    </div>
  );
}

/** Where a file is on its way: added, processed by your agent, reviewed by you. */
function Flow({ step }: { step: 1 | 2 | 3 }) {
  const steps = [
    ["In the inbox", "You added the file."],
    ["Your agent processes it", "At the start of your next session, before anything else. It writes draft cards citing the file."],
    ["You review the drafts", "They appear at the top of this inbox."],
  ];
  return (
    <ol className="flow">
      {steps.map(([title, text], i) => (
        <li key={title} className={i + 1 < step ? "is-done" : i + 1 === step ? "is-current" : ""}>
          <span className="flow__marker">{i + 1 < step ? "✓" : i + 1}</span>
          <span>
            <b>{title}</b>
            <span>{text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function WaitingFile({ item }: { item: Waiting }) {
  const [content, setContent] = useState<string>();
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    if (!item.supported) return;
    get<{ content: string }>(`/api/inbox/file?name=${encodeURIComponent(item.name)}`)
      .then((r) => setContent(r.content))
      .catch(() => setContent(undefined));
  }, [item]);
  const remove = async () => {
    const r = await post("/api/inbox/remove", { name: item.name });
    if (r.ok) {
      bump();
      location.replace("#/inbox");
    } else setProblem(r.problems?.[0]?.message ?? "Could not remove the file.");
  };
  return (
    <div className="reader">
      <div className="reader__scroll">
        <article className="reader__inner">
          <div className="reader__eyebrow">
            <span className="status">Waiting for your agent</span>
            <span>·</span>
            <span className="mono">
              added {ago(item.mtime)} · {kb(item.size)}
            </span>
          </div>
          <h1 className="reader__title">{item.name}</h1>
          <Flow step={2} />
          {item.supported ? (
            <div className="inbox-next">
              <p style={{ margin: 0 }}>
                <b>Nothing to do.</b> Your agent processes this file at the start of your next session, then its drafts appear at the
                top of this inbox. To do it right away, say to your agent:
              </p>
              <CopyLine kind="prompt" label="In any session" text="Process the Stet inbox." />
            </div>
          ) : (
            <p className="notice">
              Your agent reads text only ({INBOX_TYPES.join(" ")}). Convert this file to text or markdown and add it again, or remove it.
            </p>
          )}
          {problem && <p className="notice text-critical">{problem}</p>}
          {content !== undefined && (
            <>
              <h2 className="ro-eyebrow" style={{ marginTop: 32 }}>
                Content
              </h2>
              <pre className="inbox-preview">{content}</pre>
            </>
          )}
        </article>
      </div>
      <div className="actionbar">
        <div className="actionbar__hint">The file stays in inbox/ until your agent processes it.</div>
        <Button onClick={() => void remove()}>Remove from the inbox</Button>
      </div>
    </div>
  );
}

function InboxEmpty() {
  return (
    <div className="empty-state inbox-empty">
      <h2>Nothing new</h2>
      <p>
        What your agent keeps lands here as drafts for you to validate. Type <code className="mono">/stet</code> in a session to keep
        something. For what you learned elsewhere (meeting notes, a transcript, an article, a link), add it here: your agent turns it into
        drafts at the start of your next session.
      </p>
      <Flow step={1} />
      <Button variant="primary" onClick={openInbox}>
        Add to the inbox
      </Button>
      <p className="muted" style={{ fontSize: 12.5 }}>
        You can also drop files anywhere on this window, or put them in the <code className="mono">inbox/</code> folder of your wiki.
      </p>
    </div>
  );
}
