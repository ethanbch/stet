# Changelog

## 0.1.0 — 2026-11-03

First release. Stet lets a coding agent keep what you learn while you work, as linked markdown cards in `~/Stet`, and gives you a local interface to validate them. Stet has no model: it checks every write.

### Install

```sh
npm install -g stet && stet connect
```

Node 22.12 or later. macOS for the on-demand start. Claude Code is the tested agent; any MCP client can use `stet mcp`.

### Keep

- `/stet` in Claude Code keeps what the session established; `/stet <what>` keeps only that. "Keep this" works too.
- The agent writes a session note, then cards that cite it. Every card is a draft until you validate it.
- Each card has a kind (decision, fix, fact, how-to, reference), a project (from a list you can extend; for a capture, the folder you work in) and free topics. The agent fills them; you change them in one click.
- The inbox takes what you learn elsewhere: meeting notes, transcripts, articles, links. Add files from the interface or drop them on the window; your agent turns them into drafts at the start of your next session, with no command to type.
- Excluded folders block capture, for repositories you must not copy from.

### Check

- Every write is validated: format, at least one source and one topic, links to existing cards, no near-duplicate title, kind and project from their lists.
- `stet lint` and the Checks screen find broken links (including links to a rejected card), missing sources, orphans, possible duplicates, an out-of-date index, files waiting too long and old drafts.

### Interface

`stet open`, or install it as an app from Safari or Chrome.

- **Today**: drafts to review, cards, recalls, inbox, a 14-day chart, *Your wiki at work* (which card your agent used, in which project, for what question), what needs attention, recent changes.
- **Inbox**: files for your agent on top, drafts for you below. `↑` `↓` move, `v` validates, `r` rejects, `e` edits. A validated card the agent changed opens on a word diff.
- **Cards**: grouped by project, filtered by words, status, project, kind or topic. Cards open read-only; *Edit* opens a markdown editor set like the card.
- **Graph**: one 2D view; colour by project, kind or topic.
- **Checks**: problems with the card next to them, rejected cards you can read and restore, the log.
- ⌘K search with a preview, `←` `→` between tabs, light and dark themes, a six-step guide for the first run.

### Files

Plain markdown in `~/Stet/cards/`, readable in any editor or as an Obsidian vault. `index.md` and `log.md` are generated. Wikis made before cards had their name move from `fiches/` to `cards/` on first open.
