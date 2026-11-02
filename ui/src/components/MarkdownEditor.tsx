import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

/**
 * The card's text as markdown, set like the rendered card: same type, headings and emphasis styled,
 * the markdown marks shown in grey. No box: editing looks like reading with the marks visible.
 */
const style = HighlightStyle.define([
  { tag: [t.heading1, t.heading2, t.heading3, t.heading4], fontWeight: "600", fontSize: "18px", letterSpacing: "-0.01em" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: "13.5px", background: "var(--surface-sunken)", borderRadius: "4px" },
  { tag: t.quote, color: "var(--ink-secondary)" },
  // # ** _ ` > - [ ] ( ): the marks themselves, quiet.
  { tag: [t.processingInstruction, t.punctuation, t.contentSeparator, t.labelName], color: "var(--ink-muted)" },
]);

const wikiLinks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    matcher = new MatchDecorator({ regexp: /\[\[[^\]\n]+\]\]/g, decoration: Decoration.mark({ class: "cm-wikilink" }) });
    constructor(view: EditorView) {
      this.decorations = this.matcher.createDeco(view);
    }
    update(u: ViewUpdate) {
      this.decorations = this.matcher.updateDeco(u, this.decorations);
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.theme({
  "&": { fontSize: "16px", color: "var(--ink)", background: "transparent" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-sans)", lineHeight: "1.72", overflow: "visible" },
  ".cm-content": { padding: "0", caretColor: "var(--accent)" },
  ".cm-line": { padding: "0" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": { background: "var(--accent-wash) !important" },
  ".cm-placeholder": { color: "var(--ink-muted)" },
});

export function MarkdownEditor({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string;
  onChange: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // The editor keeps its own state; these refs let its key bindings call the latest handlers.
  const handlers = useRef({ onChange, onSave, onCancel });
  handlers.current = { onChange, onSave, onCancel };

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => (handlers.current.onSave(), true) },
            { key: "Mod-Enter", run: () => (handlers.current.onSave(), true) },
            { key: "Escape", run: () => (handlers.current.onCancel(), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(style),
          wikiLinks,
          theme,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Card text, markdown", spellcheck: "true" }),
          placeholder("Write the card in markdown. Link a card with [[Its title]]."),
          EditorView.updateListener.of((u) => u.docChanged && handlers.current.onChange(u.state.doc.toString())),
        ],
      }),
    });
    view.focus();
    // Start at the end of the text, where you usually add.
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return () => view.destroy();
    // The document is set once, when editing starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="md-editor" ref={host} />;
}
