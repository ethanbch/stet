import { useEffect, useState, type ReactNode } from "react";
import { ago, post, useData } from "../api";
import { Button } from "../readout/Button";
import { SegmentedMeter } from "../readout/SegmentedMeter";

export interface SetupState {
  wiki: string;
  agent: { first_seen: string; last_seen: string; last_folder?: string; sessions: number } | null;
  fiches: number;
  sessionNotes: number;
  validated: number;
  drafts: number;
  imports: number;
  inbox: number;
  excluded: number;
  onDemand: boolean;
  platform: string;
  port: number;
}

interface Step {
  id: string;
  title: string;
  done: boolean;
  optional?: boolean;
  summary: string;
  body: ReactNode;
}

const HIDDEN = "stet-setup-hidden";
const INSTALLED = "stet-installed";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // private mode: the choice lasts for this window only
  }
};

/** True once Stet has run as an installed app (Dock, Chrome app), remembered across tabs. */
function useInstalled(): boolean {
  const [installed, setInstalled] = useState(() => read(INSTALLED) === "1");
  useEffect(() => {
    const standalone =
      matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) {
      write(INSTALLED, "1");
      setInstalled(true);
    }
  }, []);
  return installed;
}

export function useSetupHidden(): [boolean, (v: boolean) => void] {
  const [hidden, setHidden] = useState(() => read(HIDDEN) === "1");
  useEffect(() => {
    const on = () => setHidden(read(HIDDEN) === "1");
    addEventListener("stet-setup", on);
    return () => removeEventListener("stet-setup", on);
  }, []);
  return [
    hidden,
    (v) => {
      write(HIDDEN, v ? "1" : null);
      dispatchEvent(new Event("stet-setup"));
    },
  ];
}

function CopyLine({ text, kind }: { text: string; kind: "command" | "prompt" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`copyline copyline--${kind}`}>
      <span className="copyline__label">{kind === "command" ? "Terminal" : "Say to your agent"}</span>
      <code className="copyline__text">{text}</code>
      <button
        className="copyline__button"
        onClick={() =>
          navigator.clipboard?.writeText(text).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => setCopied(false),
          )
        }
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Reveal({ what, label, platform }: { what: "inbox" | "wiki" | "config"; label: string; platform: string }) {
  if (platform !== "darwin") return null;
  return <Button onClick={() => void post("/api/reveal", { what })}>{label}</Button>;
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <p className="waiting">
      <span className="waiting__dot" aria-hidden />
      {children}
    </p>
  );
}

function Check({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <li className={`subcheck ${done ? "is-done" : ""}`}>
      <span className="subcheck__box" aria-hidden>
        {done && <CheckIcon />}
      </span>
      <span>{children}</span>
      <span className="sr-only">{done ? "done" : "not done"}</span>
    </li>
  );
}

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2.5 6.2l2.3 2.3 4.7-5" />
  </svg>
);

export function buildSteps(s: SetupState, installed: boolean): Step[] {
  return [
    {
      id: "connect",
      title: "Connect Claude Code",
      done: !!s.agent,
      summary: s.agent
        ? `${s.agent.sessions} ${s.agent.sessions === 1 ? "session" : "sessions"} so far. Last: ${ago(s.agent.last_seen)}${s.agent.last_folder ? `, in ${s.agent.last_folder}` : ""}.`
        : "Register Stet once, then open a new session.",
      body: s.agent ? (
        <>
          <p>
            Claude Code starts Stet in every session. The agent knows how to keep, find and check fiches; you do not have to explain
            it.
          </p>
          <p className="muted">
            Work on client or employer code? List those folders as <code>excluded</code> in <code>config.toml</code>: the agent never
            captures from them.
          </p>
          <div className="step__actions">
            <Reveal what="config" label="Show config.toml" platform={s.platform} />
          </div>
        </>
      ) : (
        <>
          <p>Run this once in a terminal. It registers Stet for all your projects and installs a short skill for the agent.</p>
          <CopyLine kind="command" text="stet connect" />
          <p className="muted">Then start a new Claude Code session. Sessions that were already open do not see Stet.</p>
          <Waiting>Waiting for a first session. This step checks itself.</Waiting>
        </>
      ),
    },
    {
      id: "capture",
      title: "Keep something from a session",
      done: s.fiches > 0,
      summary: s.fiches
        ? `${s.fiches} ${s.fiches === 1 ? "fiche" : "fiches"} written, from ${s.sessionNotes} ${s.sessionNotes === 1 ? "session note" : "session notes"}.`
        : "After a decision, a fix or a fact worth keeping.",
      body: (
        <>
          <p>In any project, when you decide something, fix a bug or learn a fact you will need again, tell your agent:</p>
          <CopyLine kind="prompt" text="Keep this in Stet." />
          <p className="muted">
            It writes a session note, the account of what was decided and how, then a fiche that cites it. The agent may also offer
            to keep something, at most once per session.
          </p>
          {s.fiches === 0 && <Waiting>Waiting for a first fiche. It appears here a second after it is written.</Waiting>}
        </>
      ),
    },
    {
      id: "review",
      title: "Validate your first fiche",
      done: s.validated > 0,
      summary: s.validated ? `${s.validated} validated.` : s.drafts ? `${s.drafts} ${s.drafts === 1 ? "draft waits" : "drafts wait"} for you.` : "Everything the agent writes starts as a draft.",
      body: (
        <>
          <p>
            Read what your agent wrote. If the text is right and the source supports it, validate it. If not, ask the agent to fix it,
            or reject it.
          </p>
          <div className="step__actions">
            <Button variant="primary" disabled={!s.drafts} onClick={() => (location.hash = "#/review")}>
              Open review
            </Button>
            <span className="keys">
              <kbd>v</kbd> validate <kbd>r</kbd> reject <kbd>j</kbd>
              <kbd>k</kbd> move
            </span>
          </div>
        </>
      ),
    },
    {
      id: "inbox",
      title: "Feed the inbox",
      optional: true,
      done: s.imports > 0,
      summary: s.imports ? `${s.imports} ${s.imports === 1 ? "file" : "files"} processed.` : "Meeting notes, transcripts, articles.",
      body: (
        <>
          <p>
            Drop text files in <code>{s.wiki}/inbox</code>: <code>.md</code>, <code>.txt</code>, <code>.vtt</code>, <code>.srt</code>. Then
            ask in any session:
          </p>
          <CopyLine kind="prompt" text="Process the Stet inbox." />
          <div className="step__actions">
            <Reveal what="inbox" label="Open the inbox folder" platform={s.platform} />
            {s.inbox > 0 && (
              <span className="muted" style={{ fontSize: 12.5 }}>
                {s.inbox} {s.inbox === 1 ? "file waits" : "files wait"} in the inbox.
              </span>
            )}
          </div>
        </>
      ),
    },
    {
      id: "dock",
      title: "Keep Stet in your Dock",
      optional: true,
      done: s.onDemand && installed,
      summary: s.onDemand && installed ? "Opens from the Dock, starts on demand." : "One click to review, no terminal.",
      body: (
        <ul className="subchecks">
          <Check done={s.onDemand}>
            <b>Start on demand.</b> macOS starts Stet when the window opens and stops it when idle.
            {!s.onDemand && <CopyLine kind="command" text="stet connect --launchd" />}
          </Check>
          <Check done={installed}>
            <b>Add the window to the Dock.</b> Safari: File › Add to Dock. Chrome: the install icon in the address bar.
          </Check>
        </ul>
      ),
    },
  ];
}

/** The first-run guide. Steps check themselves from the wiki's files; nothing to tick by hand. */
export function SetupGuide() {
  const { data } = useData<SetupState>("/api/setup");
  const installed = useInstalled();
  const [hidden, setHidden] = useSetupHidden();
  const [open, setOpen] = useState<string>();
  if (!data) return null;

  const steps = buildSteps(data, installed);
  const done = steps.filter((s) => s.done).length;
  const essentials = steps.filter((s) => !s.optional).every((s) => s.done);
  const current = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  const expanded = open ?? current?.id;

  return (
    <div className="page setup">
      <header className="setup__intro">
        <h2 className="ro-eyebrow">Get started</h2>
        <h1 className="setup__title">{essentials ? "Stet is set up" : "Set up Stet in a few minutes"}</h1>
        <p className="setup__lead">
          {essentials
            ? "Your agent writes, you validate. The optional steps make it faster to use."
            : "Your agent keeps what you learn while you work; you review it here. Each step checks itself as soon as it is done."}
        </p>
        <div className="setup__progress">
          <SegmentedMeter value={done / steps.length} label="Setup progress" segments={steps.length} />
          <span className="mono">
            {done} of {steps.length} done
          </span>
        </div>
        <div className="step__actions" style={{ marginTop: 20 }}>
          {essentials && <Button onClick={() => (location.hash = "#/")}>Go to Today</Button>}
          <button className="link-button" onClick={() => setHidden(!hidden)}>
            {hidden ? "Show the guide in the sidebar" : "Hide this guide"}
          </button>
        </div>
      </header>

      <ol className="steps">
        {steps.map((s, i) => {
          const state = s.done ? "is-done" : s.id === current?.id ? "is-current" : "is-todo";
          const isOpen = expanded === s.id;
          return (
            <li key={s.id} className={`step ${state}`}>
              <button className="step__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? "" : s.id)}>
                <span className="step__marker" aria-hidden>
                  {s.done ? <CheckIcon /> : i + 1}
                </span>
                <span className="step__text">
                  <span className="step__title">
                    {s.title}
                    {s.optional && <span className="badge">Optional</span>}
                  </span>
                  <span className="step__summary">{s.summary}</span>
                </span>
                <span className="step__state">{s.done ? "Done" : s.id === current?.id ? "Next" : ""}</span>
              </button>
              {isOpen && <div className="step__body">{s.body}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** A one-line reminder on Today while the essentials are not done. */
export function SetupBanner() {
  const { data } = useData<SetupState>("/api/setup");
  const installed = useInstalled();
  const [hidden, setHidden] = useSetupHidden();
  if (!data || hidden) return null;
  const steps = buildSteps(data, installed);
  const next = steps.find((s) => !s.done && !s.optional);
  if (!next) return null;
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="setup-banner">
      <div className="setup-banner__meter">
        <SegmentedMeter value={done / steps.length} label="Setup progress" segments={steps.length} />
      </div>
      <span className="setup-banner__text">
        <b>Setup {done} of {steps.length}.</b> Next: {next.title}.
      </span>
      <a className="ro-link" href="#/setup">
        Continue →
      </a>
      <button className="icon-button" aria-label="Hide the setup guide" onClick={() => setHidden(true)}>
        ×
      </button>
    </div>
  );
}

/** Sidebar entry: progress while the guide is useful and not hidden. */
export function useSetupProgress(): { done: number; total: number; complete: boolean } | undefined {
  const { data } = useData<SetupState>("/api/setup");
  const installed = useInstalled();
  if (!data) return undefined;
  const steps = buildSteps(data, installed);
  return {
    done: steps.filter((s) => s.done).length,
    total: steps.length,
    complete: steps.filter((s) => !s.optional).every((s) => s.done),
  };
}
