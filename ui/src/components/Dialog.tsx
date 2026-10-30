import { useEffect, type ReactNode } from "react";

/** Readout dialog: closes on Escape and on the scrim. */
export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    addEventListener("keydown", on, true);
    return () => removeEventListener("keydown", on, true);
  }, [onClose]);
  return (
    <div className="ro-scrim" onClick={onClose}>
      <div className="ro-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="ro-dialog__head">
          <h2 className="ro-dialog__title">{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ro-dialog__body">{children}</div>
      </div>
    </div>
  );
}
