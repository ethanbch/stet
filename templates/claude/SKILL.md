---
name: stet
description: The user's Stet wiki, a markdown knowledge base you maintain through the stet MCP tools. Typed as /stet, it keeps what this session established (optionally only what follows /stet). Also use when the user says "keep this", "save this in Stet", "garde ça", asks what they know or decided about a topic, wants the Stet inbox processed, or wants the wiki checked. Also use when a task ends with a durable decision, a solved problem or a learned fact, to propose a capture once.
argument-hint: "[what to keep]"
---

# Stet

The stet MCP server validates every write. You write and judge. Full rules: read `AGENTS.md` with the `read` tool (path `AGENTS.md`).

## /stet

The user typed `/stet`, so they want something from this session kept. Do it now, without asking first: follow "Keep something from this session" below.

- With text after `/stet` ($ARGUMENTS): keep only that.
- Without: keep the most durable thing this session established (a decision and its reason, a problem solved, a fact learned). If there are several, keep each as its own card. If there is truly nothing, say so in one line.

"Stet" is the proofreader's mark for "let it stand": keep it.

## Keep something from this session

When the user types `/stet`, says "keep this" (or accepts your proposal):

1. `write_session_note`: what was established and how, in a few lines. Add artefacts: file paths with the commit, URLs, tickets.
2. `search` the topic. If a card covers it, `read` it and update it with `update: true`.
3. `write_card`: one idea per card, sources = the session note path plus the artefacts, `kind` (decision, fix, fact, how-to, reference), `project` = `status.project`, at least one topic tag, `[[links]]` to related cards.
4. Tell the user in one line what you saved and that it waits for their validation in Stet.

Propose a capture at most once per session, and never if `status` says capture is disabled in this folder.

## Answer from the wiki

`search`, then `read` the best hits. Cite card titles in your answer. Say when the wiki has nothing on the topic.

## Process the inbox

Run this at the start of a session when files wait in the inbox (the SessionStart note or `status` says so), without asking, and whenever the user asks. Loop: `queue_next`, write the cards it supports citing `inbox/<name>`, then `complete_item` with their titles. Stop when the queue is empty, then tell the user in one line what the files became: "2 files from your Stet inbox became 3 drafts to review in Stet."

## Check the wiki

`lint`, fix what you can through `write_card`, then report what is left. For a deep check, read cards that share tags, look for contradictions and outdated facts, fix them in drafts and record the pass with `log`.
