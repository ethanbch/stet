import { useEffect, type RefObject } from "react";

/**
 * ↓ / j and ↑ / k move to the next or previous card of a list, the same way in the Inbox, Wiki and Checks.
 * Holding the key keeps moving. The selected row is kept in view.
 */
export function useListKeys(titles: string[], current: string | undefined, go: (title: string) => void, list?: RefObject<HTMLElement | null>) {
  const index = titles.findIndex((t) => t.toLowerCase() === current?.toLowerCase());

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      const down = e.key === "ArrowDown" || e.key === "j";
      const up = e.key === "ArrowUp" || e.key === "k";
      if (!down && !up) return;
      // The arrows belong to the list here, not to page scrolling, even at either end.
      e.preventDefault();
      const next = titles[down ? index + 1 : index - 1];
      if (next && index >= 0) go(next);
      else if (index < 0 && titles[0]) go(titles[0]);
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [titles, index, go]);

  useEffect(() => {
    (list?.current ?? document).querySelector('.pane__body [aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current, list]);
}
