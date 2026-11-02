import { useEffect, useRef, useState } from "react";
import { bump, post } from "../api";
import { Button } from "../readout/Button";
import { Dialog } from "./Dialog";

/** Opens the "Add to the inbox" dialog from anywhere (Today's inbox card, ⌘K). The app listens. */
export const openInbox = () => dispatchEvent(new Event("stet-inbox"));

export const INBOX_TYPES = [".md", ".markdown", ".txt", ".text", ".vtt", ".srt"];
const MAX_BYTES = 2_000_000;

export interface InboxResult {
  added: string[];
  refused: { name: string; message: string }[];
}

const supported = (name: string) => INBOX_TYPES.some((t) => name.toLowerCase().endsWith(t));

/** Sends text files to the inbox, one request each. Other formats are refused before upload. */
export async function addFiles(files: File[]): Promise<InboxResult> {
  const out: InboxResult = { added: [], refused: [] };
  for (const f of files) {
    if (!supported(f.name)) {
      out.refused.push({ name: f.name, message: `not a text file (${INBOX_TYPES.join(", ")})` });
      continue;
    }
    if (f.size > MAX_BYTES) {
      out.refused.push({ name: f.name, message: "larger than 2 MB" });
      continue;
    }
    const r = await post<{ ok: boolean; path?: string; problems?: { message: string }[] }>("/api/inbox", { name: f.name, content: await f.text() });
    if (r.ok && r.path) out.added.push(r.path.split("/").pop()!);
    else out.refused.push({ name: f.name, message: r.problems?.[0]?.message ?? "refused" });
  }
  if (out.added.length) bump();
  return out;
}

/** A pasted link becomes a small markdown file asking the agent to read the page. */
async function addPasted(text: string): Promise<InboxResult> {
  const t = text.trim();
  const isUrl = /^https?:\/\/\S+$/.test(t);
  const day = new Date().toISOString().slice(0, 10);
  const name = isUrl ? `${day} link ${new URL(t).hostname}.md` : `${day} note.md`;
  const content = isUrl ? `# ${t}\n\nSource: ${t}\n\nAdded from the Stet interface: read this page and keep what is worth keeping.\n` : t + "\n";
  const r = await post<{ ok: boolean; path?: string; problems?: { message: string }[] }>("/api/inbox", { name, content });
  if (r.ok && r.path) {
    bump();
    return { added: [r.path.split("/").pop()!], refused: [] };
  }
  return { added: [], refused: [{ name, message: r.problems?.[0]?.message ?? "refused" }] };
}

export function resultText(r: InboxResult): string {
  const parts: string[] = [];
  if (r.added.length) parts.push(`${r.added.length === 1 ? `“${r.added[0]}”` : `${r.added.length} files`} added to the inbox. Your agent processes it when you ask “process the Stet inbox”.`);
  for (const x of r.refused) parts.push(`${x.name}: ${x.message}.`);
  return parts.join(" ");
}

/** Add to the inbox: files from the disk, or a link or text pasted. */
export function InboxDialog({ onClose, onResult }: { onClose: () => void; onResult: (r: InboxResult) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const finish = (r: InboxResult) => {
    onResult(r);
    if (r.added.length && !r.refused.length) onClose();
  };
  const send = async (files: File[]) => {
    setBusy(true);
    finish(await addFiles(files));
    setBusy(false);
  };

  return (
    <Dialog title="Add to the inbox" onClose={onClose}>
      <div
        className={`dropzone ${over ? "is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          void send([...e.dataTransfer.files]);
        }}
      >
        <p style={{ margin: 0 }}>
          <b>Drop text files here</b> or{" "}
          <button className="link-button" onClick={() => picker.current?.click()}>
            choose them
          </button>
          .
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
          Meeting notes, transcripts, articles: {INBOX_TYPES.join(" ")}, up to 2 MB each.
        </p>
        <input
          ref={picker}
          type="file"
          multiple
          accept={INBOX_TYPES.join(",")}
          hidden
          onChange={(e) => void send([...(e.target.files ?? [])])}
        />
      </div>
      <label className="paste">
        <span className="ro-eyebrow">Or paste a link or some text</span>
        <textarea
          autoFocus
          rows={4}
          value={text}
          placeholder="https://… or notes"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) void addPasted(text).then(finish);
          }}
        />
      </label>
      <div className="ro-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={!text.trim() || busy}
          onClick={async () => {
            setBusy(true);
            finish(await addPasted(text));
            setBusy(false);
          }}
        >
          Add <kbd>⌘↵</kbd>
        </Button>
      </div>
    </Dialog>
  );
}

/** Files dragged anywhere over the window go to the inbox. Shows a full-window target while dragging. */
export function useWindowDrop(onResult: (r: InboxResult) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const cb = useRef(onResult);
  cb.current = onResult;
  useEffect(() => {
    const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      // A drop inside the dialog's own zone is handled there.
      if ((e.target as HTMLElement)?.closest?.(".dropzone")) return;
      void addFiles([...(e.dataTransfer?.files ?? [])]).then((r) => cb.current(r));
    };
    addEventListener("dragenter", enter);
    addEventListener("dragleave", leave);
    addEventListener("dragover", over);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragenter", enter);
      removeEventListener("dragleave", leave);
      removeEventListener("dragover", over);
      removeEventListener("drop", drop);
    };
  }, []);
  return dragging;
}
