import { ficheHref, formatMoment, useData, type Issue, type LogEntry } from "../api";
import { Card } from "../readout/Card";

const LABEL: Record<string, string> = {
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

const SEVERITY: Record<Issue["severity"], string> = { error: "Error", warning: "Warning", info: "Note" };

function Target({ issue }: { issue: Issue }) {
  if (!issue.target) return null;
  if (issue.target.includes("/")) return <span className="mono">{issue.target}</span>;
  return <a href={ficheHref(issue.target)}>{issue.target}</a>;
}

export function ChecksScreen() {
  const { data, stale } = useData<Issue[]>("/api/lint");
  const { data: log } = useData<LogEntry[]>("/api/log?limit=30");

  return (
    <div className="grid grid--main-side">
      <Card
        title="Checks"
        info="Stet checks the wiki in code, without a model. Contradictions and outdated facts need judgment: ask your agent for a deep check."
      >
        {data && !data.length && <p className="empty">No problems. The links, sources and index are consistent.</p>}
        <ul className={`rows ${stale ? "is-stale" : ""}`}>
          {data?.map((i, n) => (
            <li key={n} className="row" style={{ alignItems: "flex-start" }}>
              <span className="row__main">
                <span className="row__title" style={{ whiteSpace: "normal" }}>
                  {LABEL[i.code] ?? i.code}
                  {i.target && " · "}
                  <Target issue={i} />
                </span>
                <span className="row__sub" style={{ whiteSpace: "normal" }}>
                  {i.message}
                </span>
              </span>
              <span className={`sev sev--${i.severity}`}>{SEVERITY[i.severity]}</span>
            </li>
          ))}
        </ul>
        {!!data?.length && (
          <p className="hint">
            To fix them, ask your agent: “fix the Stet checks”. <code>stet lint --fix</code> rebuilds the index.
          </p>
        )}
      </Card>
      <Card title="Log" info="The last entries of log.md: what your agent and you changed, newest first.">
        <ul className="rows">
          {log?.map((e, n) => (
            <li key={n}>
              <div className="row" style={{ alignItems: "flex-start" }}>
                <span className="row__main">
                  <span className="row__title" style={{ whiteSpace: "normal" }}>
                    {e.action}
                    {e.title && (
                      <>
                        {" · "}
                        <a href={ficheHref(e.title)}>{e.title}</a>
                      </>
                    )}
                  </span>
                  {e.detail && <span className="row__sub">{e.detail}</span>}
                </span>
                <span className="row__meta">{formatMoment(e.at)}</span>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
