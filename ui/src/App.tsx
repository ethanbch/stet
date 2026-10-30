import { useEffect, useMemo, useState } from "react";
import { useData, useRoute, type Home } from "./api";
import { Wordmark } from "./readout/Wordmark";
import { IconChecks, IconGraph, IconReview, IconSearch, IconTheme, IconToday, IconWiki } from "./components/icons";
import { Palette } from "./components/Palette";
import { TodayScreen } from "./screens/Today";
import { ReviewScreen } from "./screens/Review";
import { WikiScreen } from "./screens/Wiki";
import { GraphScreen } from "./screens/Graph";
import { ChecksScreen } from "./screens/Checks";
import { SetupGuide, useSetupHidden, useSetupProgress } from "./screens/Setup";

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
  const { data: home } = useData<Home>("/api/home");
  const setup = useSetupProgress();
  const [setupHidden, setSetupHidden] = useSetupHidden();

  // Old links (#/fiche/X, #/search) land on the wiki.
  useEffect(() => {
    if (head === "fiche") location.replace(`#/wiki/${encodeURIComponent(arg)}`);
    if (head === "search") location.replace("#/wiki");
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
    { id: "review", label: "Review", icon: <IconReview />, count: home?.counts.drafts, accent: true },
    { id: "wiki", label: "Wiki", icon: <IconWiki />, count: home?.counts.fiches },
    { id: "graph", label: "Graph", icon: <IconGraph /> },
    { id: "checks", label: "Checks", icon: <IconChecks />, count: home ? home.lint.error + home.lint.warning : undefined },
  ];

  const commands = useMemo(
    () => [
      { label: "Go to Today", run: () => (location.hash = "#/") },
      { label: "Start review", run: () => (location.hash = "#/review") },
      { label: "Browse the wiki", run: () => (location.hash = "#/wiki") },
      { label: "Open the graph", run: () => (location.hash = "#/graph") },
      { label: "Show checks", run: () => (location.hash = "#/checks") },
      { label: "Show the setup guide", run: () => {
        setSetupHidden(false);
        location.hash = "#/setup";
      } },
      { label: "Switch theme", run: cycleTheme },
    ],
    [cycleTheme, setSetupHidden],
  );

  let screen;
  if (head === "review") screen = <ReviewScreen title={arg || undefined} />;
  else if (head === "wiki") screen = <WikiScreen title={arg || undefined} />;
  else if (head === "graph") screen = <GraphScreen />;
  else if (head === "checks") screen = <ChecksScreen />;
  else if (head === "setup") screen = <SetupGuide />;
  // An empty wiki opens on the guide: there is nothing yet to show on Today.
  else if (home && home.counts.fiches === 0 && !setupHidden) screen = <SetupGuide />;
  else screen = <TodayScreen />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <a href="#/" className="sidebar__brand" aria-label="Stet, today">
          <Wordmark name="stet" size={20} />
        </a>
        <button className="search-trigger" onClick={() => setPalette(true)}>
          <IconSearch />
          <span>Search</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
        <nav className="nav" aria-label="Sections">
          {nav.map((n) => (
            <a key={n.id} href={`#/${n.id}`} className="nav__item" aria-current={head === n.id || (n.id === "wiki" && head === "fiche") ? "page" : undefined}>
              {n.icon}
              {n.label}
              {n.count !== undefined && n.count > 0 && (
                <span className={`nav__count ${n.accent ? "nav__count--accent" : ""}`}>{n.count}</span>
              )}
            </a>
          ))}
        </nav>
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
        <div className="sidebar__foot">
          <span className="sidebar__path" title={home?.wiki}>
            {home?.wiki}
          </span>
          <button className="icon-button" onClick={cycleTheme} aria-label={`Theme: ${theme}. Switch`} title={`Theme: ${theme}`}>
            <IconTheme mode={theme} />
          </button>
        </div>
      </aside>
      <main className="main">{screen}</main>
      {palette && <Palette onClose={() => setPalette(false)} commands={commands} />}
    </div>
  );
}
