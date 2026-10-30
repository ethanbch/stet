---
name: stet
description: The user's Stet wiki, a markdown knowledge base you maintain through the stet MCP tools. Use when the user says "keep this", "save this in Stet", "garde ça", asks what they know or decided about a topic, wants the Stet inbox processed, or wants the wiki checked. Also use when a task ends with a durable decision, a solved problem or a learned fact, to propose a capture once.
---

# Stet

The stet MCP server validates every write. You write and judge. Full rules: read `AGENTS.md` with the `read` tool (path `AGENTS.md`).

## Keep something from this session

When the user says "keep this" (or accepts your proposal):

1. `write_session_note`: what was established and how, in a few lines. Add artefacts: file paths with the commit, URLs, tickets.
2. `search` the topic. If a fiche covers it, `read` it and update it with `update: true`.
3. `write_fiche`: one idea per fiche, sources = the session note path plus the artefacts, at least one tag, `[[links]]` to related fiches.
4. Tell the user in one line what you saved and that it waits for their validation in Stet.

Propose a capture at most once per session, and never if `status` says capture is disabled in this folder.

## Answer from the wiki

`search`, then `read` the best hits. Cite fiche titles in your answer. Say when the wiki has nothing on the topic.

## Process the inbox

Loop: `queue_next`, write the fiches it supports citing `inbox/<name>`, then `complete_item` with their titles. Stop when the queue is empty.

## Check the wiki

`lint`, fix what you can through `write_fiche`, then report what is left. For a deep check, read fiches that share tags, look for contradictions and outdated facts, fix them in drafts and record the pass with `log`.
