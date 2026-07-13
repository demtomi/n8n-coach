# Coach hardening — status (2026-07-13)

Context: a `/sw-advisors` council returned a unanimous BLOCK on promoting this app to the
primary portfolio CTA. The unsubstantiated "35% / 50%" case-study claims were stripped
from tamasdemeter.com the same day. This file tracks the remediation.

## Done (commit e1908ff, deployed)

Fixes 1-4 from the council, all verified end-to-end against a live dev server and a
`/code-review high` pass (which caught and fixed six issues in the first draft):

1. **Request schema** — `lib/limits.ts`. Body/message-count/char/node caps; client
   system+tool turns dropped. Caps sized so a real ~30-node workflow paste still fits.
2. **Fail-closed rate limiter** — `lib/rate-limit.ts`. Keys off `x-vercel-forwarded-for`
   (not the spoofable leftmost `x-forwarded-for`); warns loudly if no trusted header.
3. **Global daily spend ceiling** — `lib/budget.ts` + `migrations/2026-07-13-*.sql`. One
   atomic RPC does rate-limit + ceiling + a spend RESERVATION, fail-closed. Reserve-then-
   settle: concurrent requests can't all pass one under-ceiling read; an aborted stream
   keeps its reservation instead of vanishing unbilled. Default USD 3/day, override with
   `COACH_DAILY_BUDGET_CENTS` in Vercel.
4. **Gate bypass closed at detection** — `lib/debug-mode.ts`. A workflow is detected by
   its namespaced n8n node types, not any `nodes[]` key, so `{"nodes":[]}` no longer forces
   debug mode; it falls through to the off-topic similarity gate like any other text.

## Done (commit 8b714e4, deployed)

5. **The app no longer holds a service_role key.** Its DB credential is now the `coach_app`
   Postgres role, reached over the Supavisor pooler (`lib/db.ts`, off supabase-js):
   EXECUTE on `coach_match_documents` / `coach_check_and_reserve` / `coach_settle_usage`,
   and **zero table grants**. Verified against the live DB — as this role,
   `select * from prospects` is `permission denied for table prospects`, and so is
   `select * from coach_documents`. TLS pins `Supabase Root 2021 CA`
   (`lib/supabase-ca.ts`); postgres.js's `ssl: "require"` means `rejectUnauthorized: false`,
   which would have been weaker than the HTTPS it replaced.

   **The own-project plan died on a fact, not a preference.** Supabase caps free projects at
   2 **per user** (not per org — a new org does not help), and both slots are load-bearing
   (`dts-projects`, `upwork-copilot`). Custom-role API keys — the other route to a scoped
   credential without new code — are **Pro-gated** (`402`). Native Postgres auth was the only
   free path to the same credential isolation. An own-project remains the upgrade if the
   coach ever takes real traffic; ~USD 25/mo Pro + ~USD 10/mo compute is the price.

   Migration: `migrations/2026-07-13-coach-app-scoped-role.sql`. Note it makes
   `coach_match_documents` SECURITY DEFINER **and revokes EXECUTE from PUBLIC in the same
   file** — a DEFINER function left open to PUBLIC would hand the anon key an RLS bypass.

   Verified through the real HTTP path on `coach.tamasdemeter.com`, not a typecheck:
   grounded answers with correct citations, off-topic gate still refuses, oversized body
   still `413`, ledger records real token usage (so all three functions run on the new
   credential), and an unreachable DB still returns `503` with no Anthropic spend — the
   fail-closed gate survives the driver swap.

## Still open (each its own session)

5b. **Rotate the shared `claudecode` secret key.** GATED ON OWNER — not yet done. The coach
   no longer uses it, but that key sat in a public app's Vercel env for 81 days, and root
   `.env` carries the same value. Rotation is estate-wide (root `.env`, VPS agents,
   ops-dashboard, website), so it is zero-downtime only if done as mint-new → roll every
   consumer → verify green → delete old. Enumerate consumers before touching anything.

6. **Re-point the eval at the real endpoint.** `evals/run.ts` reimplements its own system
   prompt + mode classifier, so every published metric describes a shadow app, not what is
   deployed. Make the runner POST the real `/api/chat`. Until then, NO number from this repo
   is fit for a public claim (recall@5 0.778, faithfulness 0.745, "0 contradictions" all
   describe the shadow app; citation validity was 0.785, i.e. ~21% of emitted doc links are
   not in the corpus).

7. **Technical Journal re-skin + UX fixes.** Retire the dark/Instrument-Serif theme for the
   bone+pine brand. UX debt from the impeccable audit (18/40): the `<h1>` masthead is wired
   to `resetChat` (clicking the "logo" silently wipes the transcript); no stop/abort on a
   streaming generation; no retry after an error; no `aria-live` on the answer region; the
   4-chip empty state is a banned identical-card grid. Biggest opportunity: make the
   retrieval visible (cited sources, routed mode, parsed node count) so a prospect sees the
   machinery, not a generic chat box.

## Residual notes

- Off-topic gate threshold (0.25 sim / 0.30 rerank) is porous at the margin: borderline
  off-topic text can reach doc-grounded ANSWER mode (which refuses to leave n8n by prompt,
  so it is not a free-LLM proxy, but it is a tuning question). Belongs with fix 6.
- `MAX_OUTPUT_TOKENS` is 2,500. Watch for truncated debug diagnoses on large workflows.

- **The coach still shares Postgres COMPUTE with the CRM** (fix 5 removed the credential
  blast radius, not the resource one). A hammered public endpoint is a noisy neighbour to
  the business DB. The rate limiter and the spend ceiling bound it; an own Supabase project
  is what would eliminate it. Revisit if the coach ever takes real traffic.

- **New failure mode from the pooled TCP connection** (fix 5). `lib/db.ts` caches a
  connection across invocations; Vercel freezes the instance between requests, so a socket
  can die while frozen and surface as a gate error on thaw → the fail-closed branch returns
  `503` to a legitimate user. Safe direction, but it is a real availability cost that the
  old stateless-HTTP client did not have. A retry is **not** trivially safe:
  `coach_check_and_reserve` is not idempotent, so retrying a query that actually committed
  double-reserves. Any retry must be restricted to errors raised *before* the query is sent.
  Not yet observed in production — watch the logs for `[budget] gate query FAILED`.
