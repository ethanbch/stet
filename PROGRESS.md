# Stet V1 — progress

Framing doc (validated 2026-10-30): https://claude.ai/artifact/Rvz1357twLMKX6xUPrYg5p

| # | Step | State |
|---|------|-------|
| 1 | Scaffold: git, TypeScript, MIT | done |
| 2 | Fiche format + zod validation, tests | done |
| 3 | MCP server, 10 tools, stdio e2e test | done |
| 4 | Lint, index.md and log.md generation | done |
| 5 | CLI: init, status, lint, mcp | done |
| 6 | Web server (hono): API, live refresh, Host/Origin checks | done |
| 7 | CLI: open, connect; launchd on-demand start | done |
| 8 | UI: React + Vite + Readout, 5 screens, manifest | done |
| 9 | Claude Code adapter: skill, SessionStart hook | done |
| 10 | README, LICENSE | done |
| 11 | Technical test, with and without adapter | done |

## Notes
- Reads are recorded in `.stet/usage.jsonl`, not in log.md, to keep the human log readable (deviation from the framing doc, same metric).
- End-of-session reminder: fallback chosen (skill + MCP instructions + AGENTS.md); no clean Claude Code hook injects context at session end.
- Live refresh polls `/api/version` every 2 s instead of SSE: a long-lived SSE stream held a browser connection slot and delayed other requests by about 30 s. Polling stops when the window is hidden; an open window keeps the on-demand server alive.
- launchd on-demand start verified: first request after a cold start 0.31 s, then 0.02 s.
- Reuse counts a `read`, or the best `search` hit, in a later session: in the first technical test run the agent answered from the search excerpt without calling `read`.
- The `v` shortcut ignores key repeats and stale renders: during a browser test, five drafts were validated in a row.
- Fiche scan cached for 500 ms with a title index: lint on 1,000 fiches went from 5.1 s to 16 ms.
- Packed with `npm pack` and installed in a temporary prefix: `init`, `status`, `serve` work from the package.

## Technical test (2026-10-30, `node scripts/technical-test.mjs`, real `claude -p`)

| Mode | Capture | Inbox | Reuse | Lint errors |
|------|---------|-------|-------|-------------|
| With adapter | pass, 14.0 s | pass, 48.9 s | pass, 9.2 s | 0 |
| Without adapter | pass, 13.2 s | pass, 31.1 s | pass, 8.1 s | 0 |

V1 scope complete. Not done on purpose: `stet connect` on the user's machine (changes global Claude Code config), npm publish.
