import { ficheHref, formatMoment, useData, type Issue, type LogEntry } from "../api";
import { InfoTip } from "../readout/InfoTip";
import { ACTION, ISSUE } from "./Today";

const SEVERITY: Record<Issue["severity"], string> = { error: "Error", warning: "Warning", info: "Note" };

export function ChecksScreen() {
  const { data, stale } = useData<Issue[]>("/api/lint");
  const { data: log } = useData<LogEntry[]>("/api/log?limit=40");

  const groups = new Map<string, Issue[]>();
  for (const i of data ?? []) groups.set(i.code, [...(groups.get(i.code) ?? []), i]);
  const counts = { error: 0, warning: 0, info: 0 };
  for (const i of data ?? []) counts[i.severity]++;

  return (
    <div className={`page ${stale ? "is-stale" : ""}`}>
      <header className="page-head">
        <div>
          <h1 className="page-title">Checks</h1>
          <p className="page-sub">
            {data && !data.length
              ? "No problems: links, sources and the index are consistent."
              : `${counts.error} ${counts.error === 1 ? "error" : "errors"}, ${counts.warning} ${counts.warning === 1 ? "warning" : "warnings"}, ${counts.info} ${counts.info === 1 ? "note" : "notes"}. Ask your agent “fix the Stet checks”.`}
          </p>
        </div>
      </header>

      <div className="two-col">
        <section>
          {[...groups].map(([code, items]) => (
            <div key={code} className="section">
              <div className="section__head">
                <h2 className="ro-eyebrow">
                  {ISSUE[code] ?? code} · {items.length}
                </h2>
                <span className={`sev sev--${items[0].severity}`}>{SEVERITY[items[0].severity]}</span>
              </div>
              <ul className="list">
                {items.map((i, n) => (
                  <li key={n}>
                    {i.target && !i.target.includes("/") ? (
                      <a className="item" href={ficheHref(i.target)}>
                        <span className="item__main">
                          <span className="item__title">{i.target}</span>
                          <span className="item__sub">{i.message}</span>
                        </span>
                      </a>
                    ) : (
                      <div className="item">
                        <span className="item__main">
                          <span className="item__title mono" style={{ fontSize: 13 }}>
                            {i.target ?? "index.md"}
                          </span>
                          <span className="item__sub">{i.message}</span>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {data && !data.length && <p className="empty">Nothing to fix.</p>}
        </section>

        <section className="section">
          <div className="section__head">
            <div className="section__title">
              <h2 className="ro-eyebrow">Log</h2>
              <InfoTip text="The last entries of log.md: what your agent and you changed, newest first." />
            </div>
          </div>
          <ul className="list">
            {log?.map((e, n) => (
              <li key={n}>
                <div className="item">
                  <span className="item__main">
                    <span className="item__title">
                      {ACTION[e.action] ?? e.action}
                      {e.title && (
                        <>
                          {" · "}
                          <a href={ficheHref(e.title)}>{e.title}</a>
                        </>
                      )}
                    </span>
                    <span className="item__sub">
                      {e.session === "user" ? "You" : e.session ? "Your agent" : ""}
                      {e.detail ? ` · ${e.detail}` : ""}
                    </span>
                  </span>
                  <span className="item__meta">{formatMoment(e.at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
