
import { useId, useState } from "react";

/** A ⓘ beside a card title; the explanation opens on hover, focus or tap. */
export function InfoTip({ text, label = "Explanation" }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="ro-info">
      <button
        type="button"
        className="ro-info__button"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3" />
          <path d="M8 7.2V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="5" r=".9" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <span role="tooltip" id={id} className="ro-tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
