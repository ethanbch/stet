import { ago, ficheHref, formatMoment, useData, type ActivityDay, type Home, type Issue, type LogEntry } from "../api";
import { Button } from "../readout/Button";
import { InfoTip } from "../readout/InfoTip";
import { Activity } from "../components/Activity";
import { IconArrow } from "../components/icons";

const today = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());

export const ACTION: Record<string, string> = {
  create: "Written",
  update: "Changed",
  validate: "Validated",
  unvalidate: "Back to review",
  reject: "Rejected",
  tags: "Tags changed",
  import: "Inbox processed",
  "session-note": "Session note",
  note: "Agent note",
};

export const ISSUE: Record<string, string> = {
  invalid_fiche: "Invalid fiche",
  broken_link: "Broken link",
  missing_source: "Missing source",
  orphan: "Orphan",
  duplicate: "Possible duplicate",
  index_out_of_sync: "Index out of date",
  stale_inbox: "Waiting in inbox",
  unsupported_inbox: "Unsupported file",
  stale_draft: "Old draft",
};

export function TodayScreen() {
  const { data: home, stale } = useData<Home>("/api/home");
  const { data: activity } = useData<ActivityDay[]>("/api/activity?days=14");
  const { data: issues } = useData<Issue[]>("/api/lint");
  const { data: log } = useData<LogEntry[]>("/api/log?limit=8");
  if (!home) return null;
  const { counts } = home;
  const oldest = home.drafts.at(-1);
  // Inbox items are listed above; the rest is grouped by kind, errors first.
  const attention = (issues ?? []).filter((i) => i.severity !== "info" && i.code !== "stale_inbox" && i.code !== "unsupported_inbox");
  const byCode = new Map<string, Issue[]>();
  for (const i of attention) byCode.set(i.code, [...(byCode.get(i.code) ?? []), i]);
  const groups = [...byCode].slice(0, 5);

  return (
    <div className={`page ${stale ? "is-stale" : ""}`}>
      <header className="page-head">
        <div>
          <h1 className="page-title">Today</h1>
          <p className="page-sub">{today[0].toUpperCase() + today.slice(1)}</p>
        </div>
      </header>

      <div className="today-top">
        <section className="review-callout">
          <div>
            <h2 className="ro-eyebrow">To review</h2>
            <p className="big">
              {counts.drafts}
              <small>{counts.drafts === 1 ? "draft" : "drafts"}</small>
            </p>
            <p className="page-sub" style={{ marginTop: 12 }}>
              {counts.drafts
                ? `Written by your agent. The oldest was written ${oldest ? ago(oldest.updated) : "today"}.`
                : "Nothing waits for you. New captures land here."}
            </p>
          </div>
          {counts.drafts > 0 && (
            <div>
              <Button variant="primary" large onClick={() => (location.hash = "#/review")}>
                Start review <IconArrow />
              </Button>
            </div>
          )}
          <dl className="stats">
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
            <div>
              <dt>Inbox</dt>
              <dd>{counts.inbox}</dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="section__head">
            <div className="section__title">
              <h2 className="ro-eyebrow">Last 14 days</h2>
              <InfoTip text="Fiches your agent wrote or changed per day, and reuses: a fiche read in a later session than the one that wrote it." />
            </div>
          </div>
          {activity && <Activity days={activity} />}
        </section>
      </div>

      <div className="two-col section">
        <section>
          <div className="section__head">
            <div className="section__title">
              <h2 className="ro-eyebrow">Needs attention</h2>
              <InfoTip text="Problems Stet finds in code, and files waiting in the inbox. Ask your agent “fix the Stet checks” or “process the Stet inbox”." />
            </div>
            <a className="ro-link" href="#/checks">
              All checks →
            </a>
          </div>
          <ul className="list">
            {home.inbox.map((i) => (
              <li key={i.name} className="item">
                <span className="item__main">
                  <span className="item__title mono" style={{ fontSize: 13 }}>
                    {i.name}
                  </span>
                  <span className="item__sub">
                    {i.supported ? "Waiting in the inbox: ask your agent to process it" : "Not supported: convert it to text or markdown"}
                  </span>
                </span>
                <span className="item__meta">{ago(i.mtime)}</span>
              </li>
            ))}
            {groups.map(([code, items]) => (
              <li key={code}>
                {items.length === 1 && items[0].target && !items[0].target.includes("/") ? (
                  <a className="item" href={ficheHref(items[0].target)}>
                    <span className="item__main">
                      <span className="item__title">{items[0].target}</span>
                      <span className="item__sub">{items[0].message}</span>
                    </span>
                    <span className={`sev sev--${items[0].severity}`}>{ISSUE[code] ?? code}</span>
                  </a>
                ) : (
                  <a className="item" href="#/checks">
                    <span className="item__main">
                      <span className="item__title">
                        {ISSUE[code] ?? code} <span className="mono muted">· {items.length}</span>
                      </span>
                      <span className="item__sub">{items.map((i) => i.target ?? i.message).join(", ")}</span>
                    </span>
                    <span className={`sev sev--${items[0].severity}`}>{items[0].severity === "error" ? "Error" : "Warning"}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
          {!home.inbox.length && !attention.length && <p className="empty">Nothing needs your attention.</p>}
        </section>

        <section>
          <div className="section__head">
            <h2 className="ro-eyebrow">Recent changes</h2>
            <a className="ro-link" href="#/checks">
              Log →
            </a>
          </div>
          <ul className="list">
            {(log ?? []).slice(0, 7).map((e, n) => (
              <li key={n}>
                {e.title ? (
                  <a className="item" href={ficheHref(e.title)}>
                    <span className="item__main">
                      <span className="item__title">{e.title}</span>
                      <span className="item__sub">{ACTION[e.action] ?? e.action}{e.session === "user" ? " by you" : e.session ? " by your agent" : ""}</span>
                    </span>
                    <span className="item__meta">{formatMoment(e.at)}</span>
                  </a>
                ) : (
                  <div className="item">
                    <span className="item__main">
                      <span className="item__title">{ACTION[e.action] ?? e.action}</span>
                      <span className="item__sub">{e.detail}</span>
                    </span>
                    <span className="item__meta">{formatMoment(e.at)}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {log && !log.length && <p className="empty">No activity yet.</p>}
        </section>
      </div>
    </div>
  );
}
