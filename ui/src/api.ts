import { useEffect, useRef, useState } from "react";

export type Status = "draft" | "validated";

export type Origin = "session" | "import" | "link";

export interface CardRow {
  origin: Origin;
  title: string;
  status: Status;
  tags: string[];
  kind: string | null;
  project: string | null;
  created: string;
  updated: string;
  summary: string;
  reuses: number;
  path: string;
}

export interface Projects {
  projects: { name: string; count: number }[];
  none: number;
  kinds: { name: string; count: number }[];
}

/** A card your agent pulled into a later session: where, and for what. */
export interface Recall {
  at: string;
  title: string;
  session: string;
  project?: string;
  query?: string;
}

export interface Home {
  wiki: string;
  counts: { cards: number; drafts: number; validated: number; inbox: number; unsupported: number; reuses: number };
  lint: { error: number; warning: number; info: number };
  drafts: CardRow[];
  recent: CardRow[];
  reused: Recall[];
  inbox: { name: string; size: number; mtime: string; supported: boolean }[];
}

export interface LogEntry {
  at: string;
  action: string;
  title?: string;
  detail?: string;
  session?: string;
}

export interface CardDetail extends CardRow {
  html: string;
  sources: { ref: string; kind: "url" | "session" | "import" | "file"; ok: boolean }[];
  links: { target: string; title: string | null }[];
  backlinks: string[];
  history: LogEntry[];
  revalidation: boolean;
  body: string;
  recalls: Recall[];
  /** The text you had validated, when the agent changed the card since. */
  previous: { title: string; body: string; tags: string[] } | null;
}

export interface ActivityDay {
  day: string;
  written: number;
  validated: number;
  reused: number;
}

export const KINDS = ["decision", "fix", "fact", "how-to", "reference"] as const;

export interface Hit {
  title: string;
  status: Status;
  tags: string[];
  kind?: string | null;
  project?: string | null;
  summary: string;
  excerpt: string;
  updated?: string;
}

export interface Issue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  target?: string;
}

export interface Graph {
  nodes: { id: string; status: Status; tag: string; project: string; kind: string; degree: number; orphan: boolean; island: boolean }[];
  links: { source: string; target: string }[];
  islands: number;
}

export async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

export async function post<T = { ok: boolean; problems?: { field: string; message: string }[] }>(
  url: string,
  body: unknown,
): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

/** Bumps when the wiki changes on disk (the agent writes, you edit in Obsidian). */
let version = 0;
const listeners = new Set<(v: number) => void>();
let polling = false;
let seen = "";
let build = "";

function poll() {
  if (polling) return;
  polling = true;
  const tick = async () => {
    if (!document.hidden) {
      try {
        const { version: v, build: b } = await get<{ version: string; build?: string }>("/api/version");
        // Stet was updated: load the new interface.
        if (build && b && b !== build) location.reload();
        if (b) build = b;
        if (seen && v !== seen) bump();
        seen = v;
      } catch {
        // server stopped: the next tick retries
      }
    }
    setTimeout(tick, 2000);
  };
  void tick();
}

export function useVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    poll();
    listeners.add(setV);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

export function bump() {
  version++;
  listeners.forEach((l) => l(version));
}

/**
 * Loads `url` and reloads it when the wiki changes. While reloading, the previous data stays
 * on screen (`stale` is true) so the page dims instead of flashing.
 */
export function useData<T>(url: string | null): { data?: T; error?: string; stale: boolean } {
  const v = useVersion();
  const [state, setState] = useState<{ data?: T; error?: string; url?: string }>({});
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    get<T>(url)
      .then((data) => n === seq.current && setState({ data, url }))
      .catch((e) => n === seq.current && setState((s) => ({ ...s, error: String(e.message ?? e) })))
      .finally(() => n === seq.current && setLoading(false));
  }, [url, v]);
  return { data: state.data, error: state.error, stale: loading && !!state.data };
}

export function useRoute(): string[] {
  const read = () =>
    location.hash
      .replace(/^#\/?/, "")
      .split("?")[0]
      .split("/")
      .filter(Boolean)
      .map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function hashParams(): URLSearchParams {
  return new URLSearchParams(location.hash.split("?")[1] ?? "");
}

export const cardHref = (title: string) => `#/cards/${encodeURIComponent(title)}`;
export const reviewHref = (title: string) => `#/inbox/${encodeURIComponent(title)}`;

/** The interface is in English, so dates are too, whatever the browser's language. Day first, as in "2 Nov 2026". */
export const LOCALE = "en-GB";
const dateFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", year: "numeric" });
const timeFmt = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function formatDay(iso: string): string {
  const d = new Date(iso.length === 10 ? iso + "T00:00:00" : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function formatMoment(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? iso : timeFmt.format(d);
}

export function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
