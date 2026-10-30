import { useEffect, useState } from "react";
import { useRoute } from "./api";
import { Wordmark } from "./readout/Wordmark";
import { HomeScreen } from "./screens/Home";
import { FicheScreen } from "./screens/Fiche";
import { SearchScreen } from "./screens/Search";
import { GraphScreen } from "./screens/Graph";
import { ChecksScreen } from "./screens/Checks";

const TABS = [
  { id: "", label: "Overview" },
  { id: "search", label: "Search" },
  { id: "graph", label: "Graph" },
  { id: "checks", label: "Checks" },
] as const;

type Theme = "system" | "light" | "dark";

function ThemeToggle() {
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
  const label = { system: "System theme", light: "Light theme", dark: "Dark theme" }[theme];
  return (
    <button className="ro-icon-button" onClick={() => setTheme(next[theme])} aria-label={`${label}, switch`} title={label}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.4">
        <circle cx="8" cy="8" r="5.5" />
        {theme === "system" && <path d="M8 2.5v11" />}
        {theme === "light" && <circle cx="8" cy="8" r="2" fill="currentColor" />}
        {theme === "dark" && <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />}
      </svg>
    </button>
  );
}

export function App() {
  const route = useRoute();
  const [head, ...rest] = route;
  const tab = head === "fiche" ? null : (head ?? "");

  let screen;
  if (head === "fiche" && rest.length) screen = <FicheScreen title={rest.join("/")} />;
  else if (head === "search") screen = <SearchScreen />;
  else if (head === "graph") screen = <GraphScreen />;
  else if (head === "checks") screen = <ChecksScreen />;
  else screen = <HomeScreen />;

  return (
    <div className="app">
      <header className="app-header">
        <a href="#/" className="app-brand" aria-label="Stet, overview">
          <Wordmark name="stet" size={22} />
        </a>
        <ThemeToggle />
      </header>
      <nav className="app-nav">
        <div className="ro-tabs" role="tablist">
          {TABS.map((t) => (
            <a
              key={t.id}
              href={`#/${t.id}`}
              className="ro-tab"
              role="tab"
              aria-selected={tab === t.id}
            >
              {t.label}
            </a>
          ))}
        </div>
      </nav>
      <main className="app-main">{screen}</main>
    </div>
  );
}
