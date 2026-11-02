// Builds a demo wiki for screenshots: a developer's notes after a few weeks of agent sessions.
// Run after `npm run build`: node scripts/demo.mjs <folder>
import fs from "node:fs";
import { Vault } from "../dist/vault.js";

const root = process.argv[2];
if (!root) {
  console.error("usage: node scripts/demo.mjs <folder>");
  process.exit(1);
}
fs.rmSync(root, { recursive: true, force: true });
const vault = new Vault(root);
vault.init();

const sessions = [
  ["Billing service migration", "Moved invoices from the monolith to the billing service. Decided on outbox events, kept idempotency keys."],
  ["Postgres slow queries", "Investigated p95 latency on the orders list. Added a partial index, rewrote one N+1."],
  ["Auth rework", "Replaced long-lived JWTs with short access tokens and rotating refresh tokens."],
  ["Deploy pipeline", "Blue-green deploys on the API, migrations run before the switch, feature flags for risky paths."],
  ["Frontend performance", "Cut the dashboard bundle by half: route splitting, dropped moment, virtualised the big table."],
  ["Test suite cleanup", "Flaky tests traced to shared state and real clocks. Fake timers, one database per worker."],
  ["Search feature", "Chose Postgres full-text search over a separate engine for now."],
];
const notes = sessions.map(([title, content], i) => {
  const r = vault.writeSessionNote({ title, content }, { session: `s-demo-${i}` });
  return r.path;
});

// [title, session index, tags, body, validated]
const cards = [
  ["Outbox pattern", 0, ["architecture"], "Write the event to an outbox table in the same transaction as the change; a relay publishes it. No lost events when the broker is down. Used by [[Billing service]].", true],
  ["Billing service", 0, ["architecture"], "Owns invoices and payments since the migration. Talks to the monolith through [[Outbox pattern]] events and protects writes with [[Idempotency keys]].", true],
  ["Idempotency keys", 0, ["architecture", "api"], "Clients send a key per write; the server stores the first response for 24 h and replays it. Needed for retries from [[Billing service]] and the mobile app.", true],
  ["Event naming", 0, ["architecture"], "Past tense, entity first: `invoice.paid`, `order.cancelled`. Version in the payload, not the name. See [[Outbox pattern]].", true],
  ["Strangler migration", 0, ["architecture"], "Route one endpoint at a time from the monolith to the new service behind the gateway. How [[Billing service]] moved.", false],
  ["Partial indexes", 1, ["postgres"], "Index only the rows you query: `WHERE status = 'open'` cut the orders index by 90 %. See [[Reading EXPLAIN ANALYZE]].", true],
  ["Reading EXPLAIN ANALYZE", 1, ["postgres"], "Compare estimated and actual rows first; a big gap means stale statistics. Then look for sequential scans on large tables. Related: [[Partial indexes]], [[N+1 queries]].", true],
  ["N+1 queries", 1, ["postgres", "api"], "The orders list loaded each customer separately: 51 queries per page. Fixed with one join. Spot them with [[Query logging in dev]].", true],
  ["Query logging in dev", 1, ["postgres", "tooling"], "Log every query with its duration in development; warn above 20 queries per request. Catches [[N+1 queries]] early.", true],
  ["Connection pool sizing", 1, ["postgres"], "Pool size ≈ cores × 2 per instance; more connections made latency worse. Watch with [[Reading EXPLAIN ANALYZE]] and pg_stat_activity.", false],
  ["Vacuum and bloat", 1, ["postgres"], "Autovacuum lagged on the events table; lowered the scale factor for that table only. See [[Partial indexes]].", true],
  ["Access and refresh tokens", 2, ["auth"], "Access tokens live 10 minutes; refresh tokens rotate on every use and are revoked as a family when reused. See [[Token revocation]].", true],
  ["Token revocation", 2, ["auth"], "A deny list keyed by token family, kept in Redis with a TTL equal to the refresh lifetime. Part of [[Access and refresh tokens]].", true],
  ["Session cookies vs bearer tokens", 2, ["auth", "frontend"], "The web app uses httpOnly cookies; mobile and CLI use bearer tokens. Same [[Access and refresh tokens]] underneath.", true],
  ["CSRF with cookies", 2, ["auth", "frontend"], "SameSite=Lax plus a double-submit token on state-changing forms. Needed because of [[Session cookies vs bearer tokens]].", false],
  ["Password hashing", 2, ["auth"], "argon2id with the library defaults; rehash on login when parameters change.", true],
  ["Blue-green deploys", 3, ["deploy"], "Two identical stacks, switch the load balancer. Migrations must work with both versions: see [[Expand and contract migrations]].", true],
  ["Expand and contract migrations", 3, ["deploy", "postgres"], "Add the new column, write both, backfill, read the new one, then drop the old. Required by [[Blue-green deploys]].", true],
  ["Feature flags", 3, ["deploy"], "Flags for risky paths, removed within two sprints. Owners named in the flag description. Pairs with [[Blue-green deploys]].", true],
  ["Rollback checklist", 3, ["deploy"], "Switch back, check error rate, keep the new schema (see [[Expand and contract migrations]]), write a note within the hour.", false],
  ["Preview environments", 3, ["deploy", "tooling"], "One per pull request, seeded with fixtures, destroyed on merge. Linked from [[Feature flags]] reviews.", true],
  ["Route-based code splitting", 4, ["frontend"], "Each top-level route is a lazy chunk; the dashboard bundle went from 1.2 MB to 580 kB. See [[Bundle analysis]].", true],
  ["Bundle analysis", 4, ["frontend", "tooling"], "Run the analyzer on every release branch; anything above 50 kB needs a reason. Found moment.js this way, replaced in [[Date handling]].", true],
  ["Date handling", 4, ["frontend"], "Native Intl for formatting, date-fns for arithmetic; dates travel as ISO strings with offset.", true],
  ["Virtualised tables", 4, ["frontend"], "Render only visible rows above 200 rows. The orders table went from 900 ms to 40 ms. Found with [[Bundle analysis]] and the profiler.", true],
  ["Image loading", 4, ["frontend"], "Explicit width and height, lazy below the fold, AVIF with a JPEG fallback.", false],
  ["Fake timers", 5, ["testing"], "Tests that waited on real time were the main source of flakes. Use fake timers and advance them explicitly. See [[Flaky test triage]].", true],
  ["Flaky test triage", 5, ["testing"], "Quarantine after two failures in a week, fix or delete within a sprint. Usual causes: real clocks ([[Fake timers]]), shared state ([[Database per test worker]]).", true],
  ["Database per test worker", 5, ["testing", "postgres"], "Each worker gets its own schema created from a template; tests no longer step on each other. From [[Flaky test triage]].", true],
  ["Contract tests", 5, ["testing", "api"], "The billing client and service share a contract file; both run it in CI. Protects [[Idempotency keys]] behaviour.", false],
  ["Postgres full-text search", 6, ["postgres", "search"], "tsvector column, GIN index, websearch_to_tsquery. Good enough below a few million rows. Chosen over [[Search engine options]].", true],
  ["Search engine options", 6, ["search"], "Elasticsearch and Meilisearch considered; both add a service to run. Revisit when [[Postgres full-text search]] stops being enough.", true],
  ["Search ranking", 6, ["search"], "ts_rank_cd with title weighted A and body weighted C; recent items get a small boost. Built on [[Postgres full-text search]].", false],
  ["Code review checklist", -1, ["team"], "Tests for the change, migration safety ([[Expand and contract migrations]]), flags removed, docs updated.", true],
  ["On-call handbook", -1, ["team"], "First look at dashboards, then the [[Rollback checklist]]. Page the owner after 15 minutes.", true],
  ["Architecture decision records", -1, ["team", "architecture"], "One short file per decision, with context and consequences. The [[Outbox pattern]] was the first one.", true],
  ["Rate limiting", -1, ["api"], "Token bucket per API key in Redis; 429 with Retry-After. Shares Redis with [[Token revocation]].", true],
  ["Pagination", -1, ["api", "postgres"], "Cursor pagination on created_at and id; offset pagination stopped scaling past page 200.", true],
  ["Error format", -1, ["api"], "Problem details (RFC 9457) everywhere: type, title, detail, plus a request id.", true],
];

// Links must point to existing cards: write each card once its targets exist. Cards in a cycle
// are written without their links first, then updated.
// The project each session worked in, and what each card holds.
const PROJECT = ["billing-service", "shop-api", "shop-api", "platform", "dashboard", "shop-api", "shop-api"];
const KIND = {
  "Outbox pattern": "decision", "Billing service": "fact", "Idempotency keys": "decision", "Event naming": "decision",
  "Strangler migration": "how-to", "Partial indexes": "fix", "Reading EXPLAIN ANALYZE": "how-to", "N+1 queries": "fix",
  "Query logging in dev": "how-to", "Connection pool sizing": "decision", "Vacuum and bloat": "fix",
  "Access and refresh tokens": "decision", "Token revocation": "decision", "Session cookies vs bearer tokens": "decision",
  "CSRF with cookies": "fact", "Password hashing": "decision", "Blue-green deploys": "decision",
  "Expand and contract migrations": "how-to", "Feature flags": "decision", "Rollback checklist": "how-to",
  "Preview environments": "fact", "Route-based code splitting": "fix", "Bundle analysis": "how-to", "Date handling": "decision",
  "Virtualised tables": "fix", "Image loading": "how-to", "Fake timers": "fix", "Flaky test triage": "how-to",
  "Database per test worker": "fix", "Contract tests": "decision", "Postgres full-text search": "decision",
  "Search engine options": "reference", "Search ranking": "how-to", "Code review checklist": "reference",
  "On-call handbook": "reference", "Architecture decision records": "reference", "Rate limiting": "decision",
  "Pagination": "decision", "Error format": "reference",
};
const write = ([title, s, tags, body], plain = false, update = false) => {
  const sources = s >= 0 ? [notes[s]] : ["https://example.com/handbook"];
  const text = plain ? body.replace(/\[\[([^\]]+)\]\]/g, "$1") : body;
  const project = s >= 0 ? PROJECT[s] : undefined;
  const actor = { session: `s-demo-${Math.max(0, s)}`, cwd: project ? `/Users/demo/dev/${project}` : undefined };
  const r = vault.writeCard({ title, body: text, sources, tags, update, kind: KIND[title], project }, actor);
  if (!r.ok) throw new Error(`${title}: ${JSON.stringify(r.problems)}`);
};
const targets = (body) => [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
const done = new Set();
let left = [...cards];
while (left.length) {
  const ready = left.filter((f) => targets(f[3]).every((t) => done.has(t) || t === f[0]));
  if (!ready.length) {
    write(left[0], true);
    done.add(left[0][0]);
    left.push(left.shift()); // rewritten with its links once the rest exists
    left[left.length - 1] = [...left[left.length - 1], "update"];
    continue;
  }
  for (const f of ready) {
    write(f, false, f[5] === "update");
    done.add(f[0]);
  }
  left = left.filter((f) => !ready.includes(f));
}
for (const [title, , , , ok] of cards) if (ok) vault.setStatus(title, "validated", { session: "user" });

// A later session: the agent changes a validated card (Review shows the diff) and one draft is rejected.
vault.writeCard(
  {
    title: "Feature flags",
    body: "Flags for risky paths, removed within one sprint; a CI check fails on flags older than 30 days. Owners named in the flag description. Pairs with [[Blue-green deploys]].",
    sources: [notes[3]],
    tags: ["deploy"],
    update: true,
  },
  { session: "s-demo-8" },
);
vault.writeCard({ title: "Monorepo tooling", body: "Tried Nx for a week; caching helped but config grew fast.", sources: [notes[5]], tags: ["tooling"] }, { session: "s-demo-8" });
vault.reject("Monorepo tooling", { session: "user" });

// The inbox: one call transcript the agent turned into a card, one meeting note still waiting.
fs.writeFileSync(
  `${root}/inbox/2026-10-28 payments sync.md`,
  "# Payments sync, 28 Oct\n\n- Stripe webhooks retried up to 3 days; handlers must be idempotent.\n- Refunds go through the billing service only.\n",
);
vault.writeCard(
  { title: "Webhook retries", body: "Stripe retries webhooks for up to 3 days: every handler must be idempotent. See [[Idempotency keys]].", sources: ["inbox/2026-10-28 payments sync.md"], tags: ["api"] },
  { session: "s-demo-8" },
);
vault.completeItem("2026-10-28 payments sync.md", ["Webhook retries"], { session: "s-demo-8" });
fs.writeFileSync(
  `${root}/inbox/2026-11-02 platform weekly.md`,
  "# Platform weekly, 2 Nov\n\nDecisions\n- Move preview environments to the new cluster before the end of November.\n- Drop the legacy cron runner; jobs move to the queue.\n\nOpen\n- Who owns the flag cleanup check in CI?\n",
);

vault.recordAgentSession("s-demo-9", "/Users/demo/dev/shop-api");
// Later sessions: what the agent looked up, in which project.
for (const [t, project, query, session] of [
  ["Expand and contract migrations", "shop-api", "rename a column without downtime", "s-demo-9"],
  ["N+1 queries", "shop-api", "orders page slow", "s-demo-9"],
  ["Idempotency keys", "mobile-app", "retry payment request", "s-demo-10"],
  ["Fake timers", "mobile-app", "flaky test timeout", "s-demo-10"],
  ["Partial indexes", "shop-api", "index only open orders", "s-demo-11"],
  ["Feature flags", "shop-api", "ship checkout redesign safely", "s-demo-11"],
])
  vault.recordRead(t, session, "search", { project, query });
console.log(`${cards.length} cards in ${root}`);
