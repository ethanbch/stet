import { LOCALE } from "../api";
import { useState } from "react";
import type { ActivityDay } from "../api";

const dayFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const label = (d: string) => dayFmt.format(new Date(d + "T00:00:00"));

/** Cards written and recalled per day. Hover a day for its values; the table view lists them all. */
export function Activity({ days }: { days: ActivityDay[] }) {
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...days.map((d) => Math.max(d.written, d.reused)));
  const written = days.reduce((s, d) => s + d.written, 0);
  const reused = days.reduce((s, d) => s + d.reused, 0);

  return (
    <div className="chart">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div className="legend-inline">
          <span>
            <i className="dot" style={{ background: "var(--series-1)" }} />
            Written <b className="mono">{written}</b>
          </span>
          <span>
            <i className="dot" style={{ background: "var(--series-2)" }} />
            Recalled <b className="mono">{reused}</b>
          </span>
        </div>
        <button className="link-button" onClick={() => setTable((t) => !t)}>
          {table ? "Chart" : "Table"}
        </button>
      </div>
      {table ? (
        <table className="table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Written</th>
              <th>Recalled</th>
              <th>Validated</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.day}>
                <td>{label(d.day)}</td>
                <td>{d.written}</td>
                <td>{d.reused}</td>
                <td>{d.validated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <>
          <div className="chart__bars" style={{ ["--days" as string]: days.length }} role="img" aria-label={`${written} cards written and ${reused} recalled over ${days.length} days`}>
            {days.map((d) => (
              <div key={d.day} className="chart__day" tabIndex={0}>
                <span
                  className={`chart__bar ${d.written ? "" : "chart__bar--zero"}`}
                  style={{ height: `${d.written ? Math.max(6, (d.written / max) * 100) : 2}%` }}
                />
                <span
                  className={`chart__bar chart__bar--reuse ${d.reused ? "" : "chart__bar--zero"}`}
                  style={{ height: `${d.reused ? Math.max(6, (d.reused / max) * 100) : 2}%` }}
                />
                <span className="chart__tip">
                  <b style={{ color: "var(--ink)" }}>{label(d.day)}</b> · {d.written} written · {d.reused} recalled
                </span>
              </div>
            ))}
          </div>
          <div className="chart__axis">
            <span>{label(days[0].day)}</span>
            <span>today</span>
          </div>
        </>
      )}
    </div>
  );
}
