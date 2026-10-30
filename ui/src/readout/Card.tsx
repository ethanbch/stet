import type { ReactNode } from "react";

import { InfoTip } from "./InfoTip";

/** One view: an eyebrow title, an optional ⓘ explanation and one action. */
export function Card({
  title,
  info,
  action,
  children,
  className = "",
}: {
  title?: string;
  info?: string;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ro-card ${className}`}>
      {(title || action) && (
        <header className="ro-card__header">
          <div className="ro-card__title">
            {title && <h2 className="ro-eyebrow">{title}</h2>}
            {info && <InfoTip text={info} />}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
