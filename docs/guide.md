# Stet user guide

Stet keeps a wiki of what you learn while you work with Claude Code. Your agent writes the cards; you read them and decide which ones to keep. This guide covers the daily use. For the list of commands, see the [README](../README.md#commands).

## Contents

1. [Install](#1-install)
2. [How it works in one minute](#2-how-it-works-in-one-minute)
3. [Put knowledge in](#3-put-knowledge-in)
4. [Validate what your agent wrote](#4-validate-what-your-agent-wrote)
5. [Find and reuse](#5-find-and-reuse)
6. [Your files](#6-your-files)
7. [Why a write is refused](#7-why-a-write-is-refused)
8. [Checks](#8-checks)
9. [Keep work projects out](#9-keep-work-projects-out)
10. [Open the interface from the Dock](#10-open-the-interface-from-the-dock)
11. [Troubleshooting](#11-troubleshooting)
12. [Uninstall](#12-uninstall)

## 1. Install

You need Node 22.12 or later and Claude Code.

1. Install Stet: `npm install -g stet`. From a clone of this repository: `npm install && npm run build && npm link`.
2. Connect it to Claude Code: `stet connect`. This creates the wiki in `~/Stet`, registers the `stet` MCP server for all your projects, and installs a skill and a session hook.
3. Answer the question about the on-demand start (see [section 10](#10-open-the-interface-from-the-dock)). You can change your mind later.
4. **Restart your Claude Code sessions.** A session that was already open does not see Stet.

Check it worked: in a new Claude Code session, run `/mcp`. The list shows `stet` as connected.

Then run `stet open`. On an empty wiki, the interface opens on **Get started**: six steps (connect Claude Code, keep a first card with `/stet`, validate it, feed the inbox, start Stet on demand, install it as an app) that check themselves as you do them. Reopen it any time from ⌘K › *Show the setup guide*.

## 2. How it works in one minute

```
 you work with Claude Code        you drop a file
            │                            │
  /stet or "keep this"             ~/Stet/inbox/
            │                            │
            └──────► your agent ◄────────┘
                        │  writes through Stet, which checks every card
                        ▼
                 draft cards in ~/Stet/cards/
                        │
              you review in `stet open`
                        │
                 validated cards ──► your agent reads them in later sessions
```

Three things to remember:

- **Your agent writes, you validate.** Every new or changed card is a draft until you validate it.
- **Stet has no model.** It stores, checks and displays. All the writing and judging is done by your agent.
- **Everything is plain markdown** in `~/Stet`. You can open it in Obsidian or any editor.

## 3. Put knowledge in

### During your work (the main way)

Work as usual in any project. When something worth keeping happens (a decision and its reason, a bug and its fix, a fact you looked up), type:

```
/stet
```

Add what to keep when the session covered several things: `/stet the connection pool decision`. Without it, the agent keeps the most durable thing the session established. ("Stet" is the proofreader's mark for "let it stand".)

Saying "keep this", "save this in Stet" or "garde ça" works too. The agent then:

1. writes a **session note**: a short account of what was established and how, with file paths, commits or links;
2. looks for an existing card on the topic and updates it, or creates a new one;
3. tells you what it saved.

The agent may also offer to keep something itself, at most once per session. Say no and it drops it.

### From files (the inbox)

For what you did not learn in a Claude Code session: meeting transcripts, notes, articles, a link. Add them from the **Inbox** screen (*Add*, or drop files anywhere on the window), or put the files in `~/Stet/inbox/`. That is all: at the start of your next session, your agent turns them into drafts before anything else and tells you in one line. To do it right away, say in any session:

> Process the Stet inbox.

The agent reads each file, writes the cards it supports, and moves the file to `~/Stet/sources/imports/`. It then leaves the Inbox screen; each card it became lists it under *Sources*. When a session starts with files waiting, the agent knows about them.

Accepted formats: `.md`, `.markdown`, `.txt`, `.text`, `.vtt`, `.srt`. Convert PDFs and web pages to text first, or ask your agent to do it. Other files stay in the inbox, marked as not supported.

### How cards are sorted

Every card has three labels. Your agent fills them when it writes the card; you change them from the card, in one click.

- **Kind**: what the card holds: decision, fix, fact, how-to or reference.
- **Project**: the project it belongs to. For a capture, your agent uses the folder you work in, which joins the list. You add projects with *New project…* in the project menu. Cards from the inbox get a project only when they clearly belong to one.
- **Topics**: free tags, such as postgres, auth or testing.

The **Cards** screen groups cards by project, like folders filled for you, and filters by any of the three. The **Graph** can colour cards by project, kind or topic.

## 4. Validate what your agent wrote

Open the interface:

```sh
stet open
```

It opens in your browser at `http://127.0.0.1:4747`. Go to the **Inbox**: the drafts *for you* are on top.

- the drafts are listed on the left, newest first;
- the selected card is on the right, with its sources, the cards that link to it, and its history.

| Key | Action |
| --- | --- |
| `v` | Validate and open the next draft |
| `r` | Reject (asks for confirmation) |
| `↓` / `↑` (or `j` / `k`) | Next / previous item in the Inbox, Wiki and Checks |
| `⌘K` or `/` | Search, or jump to a screen |
| `←` `→` | Previous or next tab |

Before you validate, check two things:

- **The text is right.** If not, ask your agent to fix it ("in the Stet card *Billing database*, the reason is wrong: …"), or edit the file yourself. The interface does not edit text.
- **The source supports it.** Click the session note or the imported file under *Sources* to read it.

**Reject** moves the card to `~/Stet/.stet/rejected/`. Nothing is deleted; to bring a card back, move its file back to `~/Stet/cards/`.

When your agent changes a card you had validated, it goes back to review with a notice: "You had validated this card. Your agent changed it since."

You can also change tags (*Edit tags* under the title) and send a validated card back to review.

## 5. Find and reuse

**In Claude Code**, ask your question normally:

> What did we decide about the billing database?

The agent searches Stet, reads the cards and names them in its answer. Each time your agent pulls a card into a later session, Stet counts a **recall** and keeps the project and the question. *Today* shows the count and, under *Your wiki at work*, the latest recalls; each card lists its own under *Recalled by your agent*. If that stays empty, the wiki is not paying off yet. In a folder listed in `excluded`, Stet counts the recall but keeps neither the project nor the question.

**In the interface**:

- **Wiki** lists every card. Filter by words, by status (*To review*, *Validated*) or by tag. `f` focuses the filter.
- **⌘K** finds a card by any word in it.
- **Graph** shows the links between cards. Hover or click a card to highlight its neighbours, then *Open the card*. Scroll to zoom: labels appear as you zoom in. The sliders button (top right) colours cards by tag or keeps only orphans and separate groups.

**In your editor**: open `~/Stet` as an Obsidian vault. File names match titles, so `[[links]]` work.

## 6. Your files

```
~/Stet/
  inbox/              drop files here
  sources/
    imports/          inbox files after processing
    sessions/         session notes written by the agent (read-only)
  cards/             one markdown file per card
  index.md            catalogue, rebuilt by Stet
  log.md              what changed and when, written by Stet
  AGENTS.md           the rules your agent follows
  .stet/
    config.toml       your settings
    rejected/         rejected cards
    usage.jsonl       reads by the agent, used to count recalls
```

What you can do by hand:

| You can | Avoid |
| --- | --- |
| Edit the text of a card in your editor | Editing `index.md`: Stet rebuilds it. Run `stet lint --fix` after hand edits |
| Edit the frontmatter (title, tags, status) | Removing `sources` or `tags`: the card becomes invalid and shows in Checks |
| Move a rejected card back to `cards/` | Editing session notes: they are the record of what was decided |
| Version the folder with git, or sync it | Renaming a card file without updating the links to it |

A card looks like this:

```yaml
---
title: Billing service uses PostgreSQL
status: draft            # draft = to review, validated = validated
sources:
  - sources/sessions/2026-10-30-billing-database.md
  - https://github.com/acme/billing/pull/42
tags: [billing, architecture]
created: 2026-10-30
updated: 2026-10-30
---
Billing needs concurrent writes from several workers, so it uses PostgreSQL. See [[Billing service]].
```

## 7. Why a write is refused

Stet checks every card before writing it and refuses it when:

- it has no source, or a source file that does not exist;
- a source is not under `sources/` or `inbox/` and is not a URL, or is another card;
- it has no tag;
- it links to a card that does not exist;
- its title is already taken, or differs from an existing title only by case, accents or punctuation;
- it comes from a folder you excluded.

The agent gets the reason and fixes it by itself; you do not have to do anything. If you see it retry, that is the guard working.

## 8. Checks

The **Checks** screen, and `stet lint` in a terminal, list what Stet can find without a model. Click a problem to read the card next to the list. The *Rejected* tab lists the cards you rejected; *Restore* puts one back as a draft. To fix them, tell your agent "fix the Stet checks".

| Check | What it means | What to do |
| --- | --- | --- |
| Invalid card | A file in `cards/` has broken or missing frontmatter, often after a hand edit | Fix the frontmatter, or ask the agent |
| Broken link | A `[[link]]` points to no card | Create the card, or fix the link |
| Missing source | A cited file is gone | Restore it, or replace the source |
| Orphan | No other card links here | Link it from a related card, or leave it: it is a hint, not an error |
| Possible duplicate | Two titles are nearly the same | Merge them if they cover the same thing |
| Index out of date | `index.md` does not match the cards | `stet lint --fix` |
| Waiting in inbox | A file has waited more than 7 days | Ask the agent to process the inbox |
| Unsupported file | The inbox holds a PDF, an image… | Convert it to text |
| Old draft | A draft has waited more than 14 days | Validate or reject it |

Contradictions and outdated facts need judgment: ask your agent for a "deep check of the Stet wiki".

## 9. Keep work projects out

If some projects must never end up in your wiki (client work, an employer's code), list their folders in `~/Stet/.stet/config.toml`:

```toml
excluded = ["~/Work", "~/Clients/acme"]
```

In these folders and their subfolders, the agent does not propose captures and Stet refuses its writes. Start a new session after changing the list.

## 10. Open the interface from the Dock

1. Run `stet open`.
2. Safari › File › Add to Dock. In Chrome: the install icon in the address bar, or ⋮ › Cast, save and share › Install page as app.

The window then opens like an app. For the icon to work when no server runs, enable the on-demand start once:

```sh
stet connect --launchd
```

macOS then starts Stet when the window opens (about 0.3 s the first time), and Stet stops after 10 idle minutes. Without it, run `stet open` before clicking the icon.

Other settings in `~/Stet/.stet/config.toml`: `port` (default 4747), `idle_minutes`, `inbox_stale_days`, `draft_stale_days`.

## 11. Troubleshooting

**The agent says it has no Stet tools.** The session started before `stet connect`. Restart it. Then `/mcp` must show `stet` as connected; if not, run `stet connect` again.

**The agent never offers to keep anything.** It offers at most once per session, and only after a clear decision, fix or fact. Type `/stet` whenever you want; it does not need to offer first.

**Nothing happens on `/stet`.** If Claude Code does not know the command, run `stet connect` again: it installs the skill. Otherwise, check that the project folder is not in `excluded`. Run `stet status` to see the wiki path, then look in `cards/` for new files.

**`stet: command not found`.** Your npm global folder is not on your `PATH`. Run `npm prefix -g` and add its `bin` folder to your `PATH`.

**The page does not open.** Another program may use port 4747. Set `port = 4748` in `config.toml`, then run `stet connect --launchd` again if you use the on-demand start.

**A card I edited by hand disappeared from the interface.** Its frontmatter is invalid. Open *Checks*: it lists the file and the field to fix.

**I want another wiki** (a test one, or a second one). Set `STET_HOME=/path/to/wiki` before any `stet` command, or run `stet init /path/to/wiki` to make it the default.

## 12. Uninstall

```sh
stet disconnect          # removes the MCP server, the skill, the hook and the on-demand start
npm uninstall -g stet
```

Your wiki in `~/Stet` stays. Delete the folder yourself if you no longer want it.
