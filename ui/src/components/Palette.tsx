import { useEffect, useMemo, useState } from "react";
import { get, cardHref, type CardDetail, type Hit } from "../api";
import { Status } from "./Reader";

interface Command {
  label: string;
  hint?: string;
  run: () => void;
}

/** ⌘K: jump to a card or a screen from anywhere. */
export function Palette({ onClose, commands }: { onClose: () => void; commands: Command[] }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const url = q.trim() ? `/api/search?q=${encodeURIComponent(q)}` : "/api/search";
      get<Hit[]>(url)
        .then((r) => live && setHits(r.slice(0, q.trim() ? 8 : 5)))
        .catch(() => live && setHits([]));
    }, 80);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const cmds = useMemo(
    () => commands.filter((c) => !q.trim() || c.label.toLowerCase().includes(q.trim().toLowerCase())),
    [commands, q],
  );
  type Item = { key: string; run: () => void; hit?: Hit; cmd?: Command };
  const items: Item[] = [
    ...hits.map((h) => ({ key: `f:${h.title}`, run: () => void (location.hash = cardHref(h.title)), hit: h })),
    ...cmds.map((c) => ({ key: `c:${c.label}`, run: c.run, cmd: c })),
  ];

  useEffect(() => setSel(0), [q]);

  // Preview of the selected card, fetched after a short pause so arrowing through the list stays fast.
  const selTitle = items[sel]?.hit?.title;
  const [preview, setPreview] = useState<CardDetail>();
  useEffect(() => {
    if (!selTitle) return setPreview(undefined);
    let live = true;
    const t = setTimeout(() => {
      get<CardDetail>(`/api/card?title=${encodeURIComponent(selTitle)}`)
        .then((r) => live && setPreview(r))
        .catch(() => live && setPreview(undefined));
    }, 60);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [selTitle]);

  const choose = (i: number) => {
    const it = items[i];
    if (!it) return;
    onClose();
    it.run();
  };

  return (
    <div className="palette-scrim" onClick={onClose}>
      <div className={`palette ${hits.length ? "palette--preview" : ""}`} role="dialog" aria-modal="true" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input
          className="palette__input"
          autoFocus
          placeholder="Search cards or jump to…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(items.length - 1, s + 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            }
            if (e.key === "Enter") choose(sel);
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[sel] ? `pi-${sel}` : undefined}
        />
        <div className="palette__body">
        <ul className="palette__list" id="palette-list" role="listbox">
          {hits.length > 0 && (
            <li className="palette__group ro-eyebrow" role="presentation">
              {q.trim() ? "Cards" : "Recent cards"}
            </li>
          )}
          {items.map((it, i) => (
            <li
              key={it.key}
              id={`pi-${i}`}
              role="option"
              aria-selected={i === sel}
              className="palette__item"
              onMouseEnter={() => setSel(i)}
              onClick={() => choose(i)}
            >
              {it.hit ? (
                <>
                  <span className="item__main">
                    <span className="item__title">{it.hit.title}</span>
                    {it.hit.excerpt && <span className="item__sub">{it.hit.excerpt}</span>}
                  </span>
                  <Status status={it.hit.status} />
                </>
              ) : (
                <>
                  <span className="item__main">
                    <span className="item__title">{it.cmd!.label}</span>
                  </span>
                  {it.cmd!.hint && <kbd>{it.cmd!.hint}</kbd>}
                </>
              )}
            </li>
          ))}
          {emptyRow(items.length, q)}
        </ul>
        {hits.length > 0 && (
          <aside className="palette__preview" aria-label="Preview">
            {preview && preview.title === selTitle && (
              <>
                <h3 className="palette__preview-title">{preview.title}</h3>
                <div className="palette__preview-meta">
                  <Status status={preview.status} />
                  {preview.tags.map((t) => (
                    <span key={t} className="tag">
                      {t}
                    </span>
                  ))}
                </div>
                <div className="prose prose--small" dangerouslySetInnerHTML={{ __html: preview.html }} />
                {preview.backlinks.length > 0 && (
                  <p className="palette__preview-links">
                    Linked from {preview.backlinks.slice(0, 3).join(", ")}
                    {preview.backlinks.length > 3 ? ` and ${preview.backlinks.length - 3} more` : ""}
                  </p>
                )}
              </>
            )}
          </aside>
        )}
        </div>
        <div className="palette__foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

function emptyRow(n: number, q: string) {
  if (n || !q.trim()) return null;
  return (
    <li className="palette__item" role="presentation" style={{ cursor: "default", color: "var(--ink-secondary)" }}>
      No card matches “{q}”.
    </li>
  );
}
