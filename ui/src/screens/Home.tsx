import { ago, ficheHref, formatDay, formatMoment, useData, type Home } from "../api";
import { Card } from "../readout/Card";
import { SegmentedMeter } from "../readout/SegmentedMeter";

export function Status({ status }: { status: string }) {
  return <span className={`status status--${status}`}>{status === "draft" ? "To review" : "Validated"}</span>;
}

export function HomeScreen() {
  const { data, error, stale } = useData<Home>("/api/home");
  if (error && !data) return <p className="empty">Could not load the wiki: {error}</p>;
  if (!data) return null;
  const { counts, lint } = data;
  const problems = lint.error + lint.warning;
  const share = counts.fiches ? Math.min(1, problems / counts.fiches) : 0;

  return (
    <div className={`stack ${stale ? "is-stale" : ""}`}>
      <div className="grid grid--3">
        <Card title="To review" info="Fiches your agent wrote. Only you can validate them; validated fiches go back to review when the agent changes them.">
          <p className="ro-hero__value">{counts.drafts}</p>
          <p className="ro-hero__hint">
            {counts.drafts ? "drafts waiting for your validation" : "Nothing to review."}
          </p>
          <dl className="ro-facts">
            <div>
              <dt>Fiches</dt>
              <dd>{counts.fiches}</dd>
            </div>
            <div>
              <dt>Validated</dt>
              <dd>{counts.validated}</dd>
            </div>
            <div>
              <dt>Reuses</dt>
              <dd>{counts.reuses}</dd>
            </div>
          </dl>
          {data.drafts[0] && (
            <div className="ro-actions" style={{ marginTop: 20, justifyContent: "flex-start" }}>
              <a className="ro-button ro-button--primary" href={ficheHref(data.drafts[0].title)} style={{ textDecoration: "none" }}>
                Review the latest draft
              </a>
            </div>
          )}
        </Card>

        <Card
          title="Checks"
          info="Mechanical checks Stet runs without a model: broken links, missing sources, orphans, duplicates, the index, stale items. Ask your agent to fix them."
          action={
            <a className="ro-link" href="#/checks" style={{ textDecoration: "none" }}>
              Details →
            </a>
          }
        >
          <div className="ro-gauge__head">
            <span className="ro-gauge__label">Problems per fiche</span>
            <span className="ro-gauge__value">{problems}</span>
          </div>
          <SegmentedMeter value={share} label="Problems per fiche" />
          <dl className="ro-kpis" style={{ ["--kpis" as string]: 3, marginTop: 20 }}>
            <div>
              <dt>Errors</dt>
              <dd>{lint.error}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{lint.warning}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{lint.info}</dd>
            </div>
          </dl>
        </Card>

        <Card title="Inbox" info="Files you dropped in the inbox folder. Your agent processes them when you ask it to, for example: “process the Stet inbox”.">
          {data.inbox.length ? (
            <ul className="rows">
              {data.inbox.slice(0, 6).map((i) => (
                <li key={i.name}>
                  <div className="row">
                    <span className="row__main">
                      <span className="row__title mono">{i.name}</span>
                      {!i.supported && <span className="row__sub">Not supported: convert it to text or markdown</span>}
                    </span>
                    <span className="row__meta">{ago(i.mtime)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">The inbox is empty.</p>
          )}
          <p className="hint">
            Folder: <code>{data.wiki}/inbox</code>
          </p>
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Recent">
          {data.recent.length ? (
            <ul className="rows">
              {data.recent.map((f) => (
                <li key={f.title}>
                  <a className="row" href={ficheHref(f.title)}>
                    <span className="row__main">
                      <span className="row__title">{f.title}</span>
                      {f.summary && <span className="row__sub">{f.summary}</span>}
                    </span>
                    <span className="row__meta">
                      <Status status={f.status} /> · {formatDay(f.updated)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No fiches yet. Ask your agent to keep something from a session, or drop a file in the inbox.</p>
          )}
        </Card>

        <Card title="Reused recently" info="A reuse is a fiche your agent read in a later session than the one that wrote it.">
          {data.reused.length ? (
            <ul className="rows">
              {data.reused.slice(0, 8).map((r) => (
                <li key={r.at + r.title}>
                  <a className="row" href={ficheHref(r.title)}>
                    <span className="row__title">{r.title}</span>
                    <span className="row__meta">{formatMoment(r.at)}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">No reuse yet. It counts when your agent reads a fiche in a later session.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
