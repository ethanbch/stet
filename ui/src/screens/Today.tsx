import { LOCALE, ago, cardHref, formatMoment, useData, type ActivityDay, type Home, type Issue, type LogEntry } from "../api";
import { Button } from "../readout/Button";
import { InfoTip } from "../readout/InfoTip";
import { Activity } from "../components/Activity";
import { IconArrow } from "../components/icons";
import { SetupBanner } from "./Setup";
import { openInbox } from "../components/Inbox";

const today = new Intl.DateTimeFormat(LOCALE, { weekday: "long", day: "numeric", month: "long" }).format(new Date());


export const ACTION: Record<string, string> = {
  create: "Written",
  update: "Changed",
  validate: "Validated",
  unvalidate: "Back to review",
  reject: "Rejected",
  restore: "Restored",
  inbox: "Added to the inbox",
  "inbox-remove": "Removed from the inbox",
  edit: "Edited",
  tags: "Tags changed",
  import: "Inbox processed",
  "session-note": "Session note",
  note: "Agent note",
};

export const ISSUE: Record<string, string> = {
  invalid_card: "Invalid card",
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
    <div className={`dash ${stale ? "is-stale" : ""}`}>
      <header className="dash__head">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">{today}</p>
      </header>

      <SetupBanner />

      <div className="dash__kpis">
        <section className="panel panel--accent kpi kpi--review">
          <h2 className="ro-eyebrow">To review</h2>
          <p className="big">
            {counts.drafts}
            <small>{counts.drafts === 1 ? "draft" : "drafts"}</small>
          </p>
          <p className="kpi__sub">
            {counts.drafts
              ? `Written by your agent. The oldest was written ${oldest ? ago(oldest.updated) : "today"}.`
              : "Nothing waits for you. New captures land here."}
          </p>
          {counts.drafts > 0 && (
            <Button variant="primary" onClick={() => (location.hash = "#/inbox")}>
              Start review <IconArrow />
            </Button>
          )}
        </section>
        <a className="panel kpi" href="#/cards">
          <h2 className="ro-eyebrow">Cards</h2>
          <p className="kpi__value">{counts.cards}</p>
          <p className="kpi__sub">{counts.validated} validated</p>
        </a>
        <section className="panel kpi">
          <div className="section__title">
            <h2 className="ro-eyebrow">Recalled</h2>
            <InfoTip text="Each time your agent pulled a card into a later session than the one that wrote it: the wiki paying off." />
          </div>
          <p className="kpi__value">{counts.reuses}</p>
          <p className="kpi__sub">times your agent used a card in a later session</p>
        </section>
        <section className="panel kpi">
          <a className="ro-eyebrow kpi__link" href="#/inbox">
            Inbox →
          </a>
          <p className="kpi__value">{counts.inbox}</p>
          <p className="kpi__sub">{counts.inbox ? "files waiting for your agent" : "Drop notes or a link; your agent turns them into cards."}</p>
          <Button onClick={openInbox}>Add to the inbox</Button>
        </section>
      </div>

      <section className="panel">
        <div className="section__head">
          <div className="section__title">
            <h2 className="ro-eyebrow">Last 14 days</h2>
            <InfoTip text="Cards your agent wrote or changed per day, and recalls: a card read in a later session than the one that wrote it." />
          </div>
        </div>
        {activity && <Activity days={activity} />}
      </section>

      <div className="dash__cols">
        <section className="panel dash__recalls">
          <div className="section__head">
            <div className="section__title">
              <h2 className="ro-eyebrow">Your wiki at work</h2>
              <InfoTip text="The latest cards your agent pulled into a session: the project it worked in and what it was looking for." />
            </div>
          </div>
          <ul className="list">
            {home.reused.map((r) => (
              <li key={`${r.session}-${r.title}`}>
                <a className="item" href={cardHref(r.title)}>
                  <span className="item__main">
                    <span className="item__title">{r.title}</span>
                    <span className="item__sub">
                      {r.query ? `“${r.query}”` : "no search recorded"}
                      {r.project ? ` · in ${r.project}` : ""}
                    </span>
                  </span>
                  <span className="item__meta">{formatMoment(r.at)}</span>
                </a>
              </li>
            ))}
          </ul>
          {!home.reused.length && (
            <p className="empty">
              Nothing yet. When your agent searches the wiki in a later session and uses a card, it shows here, with the project and
              the question.
            </p>
          )}
        </section>
        <section className="panel">
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
                  <a className="item" href={cardHref(items[0].target)}>
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

        <section className="panel">
          <div className="section__head">
            <h2 className="ro-eyebrow">Recent changes</h2>
            <a className="ro-link" href="#/checks?tab=log">
              All changes →
            </a>
          </div>
          <ul className="list">
            {(log ?? []).slice(0, 7).map((e, n) => (
              <li key={n}>
                {e.title ? (
                  <a className="item" href={cardHref(e.title)}>
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
