# Stet V1 — progress

Framing doc (validated 2026-10-30): https://claude.ai/artifact/Rvz1357twLMKX6xUPrYg5p

| # | Step | State |
|---|------|-------|
| 1 | Scaffold: git, TypeScript, MIT | done |
| 2 | Fiche format + zod validation, tests | done |
| 3 | MCP server, 10 tools, stdio e2e test | done |
| 4 | Lint, index.md and log.md generation | done |
| 5 | CLI: init, status, lint, mcp | done |
| 6 | Web server (hono): API, SSE, Host/Origin checks | todo |
| 7 | CLI: open, connect; launchd on-demand start | todo |
| 8 | UI: React + Vite + Readout, 5 screens, manifest | todo |
| 9 | Claude Code adapter: skill, SessionStart hook | todo |
| 10 | README, LICENSE | todo |
| 11 | Technical test, with and without adapter | todo |

## Notes
- Reads are recorded in `.stet/usage.jsonl`, not in log.md, to keep the human log readable (deviation from the framing doc, same metric).
- End-of-session reminder: fallback chosen (skill + MCP instructions + AGENTS.md); no clean Claude Code hook injects context at session end.
