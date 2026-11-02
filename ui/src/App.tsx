import { useEffect, useMemo, useState } from "react";
import { useData, useRoute, type Home } from "./api";
import { Wordmark } from "./readout/Wordmark";
import { IconChecks, IconGraph, IconInbox, IconSearch, IconTheme, IconToday, IconWiki } from "./components/icons";
import { InboxScreen } from "./screens/Inbox";
import { Palette } from "./components/Palette";
import { TodayScreen } from "./screens/Today";
import { CardsScreen } from "./screens/Cards";
import { GraphScreen } from "./screens/Graph";
import { ChecksScreen } from "./screens/Checks";
import { SetupGuide, useSetupHidden, useSetupProgress } from "./screens/Setup";
import { InboxDialog, resultText, useWindowDrop, type InboxResult } from "./components/Inbox";

type Theme = "system" | "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const t = localStorage.getItem("stet-theme");
      return t === "light" || t === "dark" ? t : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("stet-theme");
      else localStorage.setItem("stet-theme", theme);
    } catch {
      // private mode: the choice lasts for this window only
    }
  }, [theme]);
  const next: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };
  return [theme, () => setTheme((t) => next[t])];
}

const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function App() {
  const route = useRoute();
  const [head = "", ...rest] = route;
  const arg = rest.join("/");
  const [theme, cycleTheme] = useTheme();
  const [palette, setPalette] = useState(false);
  const [inbox, setInbox] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad: boolean }>();
  // After adding, show where the file went: the inbox, on that file.
  const showResult = (r: InboxResult) => {
    setToast({ text: resultText(r), bad: !r.added.length });
    if (r.added.length) location.hash = `#/inbox/${encodeURIComponent(r.added[0])}`;
  };
  const dragging = useWindowDrop(showResult);

  useEffect(() => {
    const on = () => setInbox(true);
    addEventListener("stet-inbox", on);
    return () => removeEventListener("stet-inbox", on);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  const { data: home } = useData<Home>("/api/home");
  const setup = useSetupProgress();
  const [setupHidden, setSetupHidden] = useSetupHidden();

  // Old links (#/card/X, #/search) land on the wiki; Review is now part of the inbox.
  useEffect(() => {
    if (head === "review") location.replace(`#/inbox${arg ? `/${encodeURIComponent(arg)}` : ""}`);
    // Old links: #/fiche/X and #/wiki/X (before cards had their name), #/search.
    if (head === "fiche" || head === "card" || head === "wiki")
      location.replace(`#/cards${arg ? `/${encodeURIComponent(arg)}` : ""}${location.hash.includes("?") ? "?" + location.hash.split("?")[1] : ""}`);
    if (head === "search") location.replace("#/cards");
  }, [head, arg]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      if (e.key === "/" && !(e.target as HTMLElement)?.closest("input, textarea, select")) {
        e.preventDefault();
        setPalette(true);
      }
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, []);

  const nav = [
    { id: "", label: "Today", icon: <IconToday /> },
    // The badge counts what waits for you; files waiting for your agent do not need you.
    { id: "inbox", label: "Inbox", icon: <IconInbox />, count: home?.counts.drafts, accent: true },
    { id: "cards", label: "Cards", icon: <IconWiki />, count: home?.counts.cards },
    { id: "graph", label: "Graph", icon: <IconGraph /> },
    { id: "checks", label: "Checks", icon: <IconChecks />, count: home ? home.lint.error + home.lint.warning : undefined },
  ];

  // ← and → move between the top-bar tabs, wrapping at the ends.
  const tabs = nav.map((n) => n.id);
  if (setup && !setup.complete && !setupHidden) tabs.push("setup");
  const tabKey = tabs.join("|");
  useEffect(() => {
    const ids = tabKey.split("|");
    const on = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented || palette) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable], [role=dialog]") || document.querySelector("[role=dialog]")) return;
      const current = head;
      const i = Math.max(0, ids.indexOf(current));
      const next = ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length];
      e.preventDefault();
      location.hash = `#/${next}`;
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [tabKey, head, palette]);

  const commands = useMemo(
    () => [
      { label: "Go to Today", run: () => (location.hash = "#/") },
      { label: "Browse the cards", run: () => (location.hash = "#/cards") },
      { label: "Open the graph", run: () => (location.hash = "#/graph") },
      { label: "Show checks", run: () => (location.hash = "#/checks") },
      { label: "Show the setup guide", run: () => {
        setSetupHidden(false);
        location.hash = "#/setup";
      } },
      { label: "Open the inbox: drafts to review", run: () => (location.hash = "#/inbox") },
      { label: "Add to the inbox", run: () => setInbox(true) },
      { label: "Switch theme", run: cycleTheme },
    ],
    [cycleTheme, setSetupHidden],
  );

  let screen;
  if (head === "inbox") screen = <InboxScreen id={arg || undefined} />;
  else if (head === "cards") screen = <CardsScreen title={arg || undefined} />;
  else if (head === "graph") screen = <GraphScreen />;
  else if (head === "checks") screen = <ChecksScreen title={arg || undefined} />;
  else if (head === "setup") screen = <SetupGuide />;
  // An empty wiki opens on the guide: there is nothing yet to show on Today.
  else if (home && home.counts.cards === 0 && !setupHidden) screen = <SetupGuide />;
  else screen = <TodayScreen />;

  return (
    <div className="shell">
      <header className="topbar">
        <a href="#/" className="topbar__brand" aria-label="Stet, today" title={home?.wiki}>
          <Wordmark name="stet" size={18} />
        </a>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className="nav__item" aria-current={head === n.id ? "page" : undefined}>
              {n.icon}
              {n.label}
              {n.count !== undefined && n.count > 0 && (
                <span className={`nav__count ${n.accent ? "nav__count--accent" : ""}`}>{n.count}</span>
              )}
            </a>
          ))}
          {setup && !setup.complete && !setupHidden && (
            <a href="#/setup" className="nav__item nav__item--setup" aria-current={head === "setup" ? "page" : undefined}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="nav__ring">
                <circle cx="8" cy="8" r="6" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${(setup.done / setup.total) * 37.7} 37.7`}
                  transform="rotate(-90 8 8)"
                />
              </svg>
              Get started
              <span className="nav__count">
                {setup.done}/{setup.total}
              </span>
            </a>
          )}
        </nav>
        <div className="topbar__end">
          <button className="search-trigger" onClick={() => setPalette(true)} aria-label="Search">
            <IconSearch />
            <span>Search</span>
            <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <button className="icon-button" onClick={cycleTheme} aria-label={`Theme: ${theme}. Switch`} title={`Theme: ${theme}`}>
            <IconTheme mode={theme} />
          </button>
        </div>
      </header>
      <main className="main">{screen}</main>
      {palette && <Palette onClose={() => setPalette(false)} commands={commands} />}
      {inbox && <InboxDialog onClose={() => setInbox(false)} onResult={showResult} />}
      {dragging && !inbox && (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay__box">
            <b>Drop to add to the inbox</b>
            <span>Text files: notes, transcripts, articles</span>
          </div>
        </div>
      )}
      {toast && (
        <div className={`toast ${toast.bad ? "toast--bad" : ""}`} role="status">
          {toast.text}
          <button className="icon-button" onClick={() => setToast(undefined)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
