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

## Done (commit 0adb25f, deployed)

6. **The eval measures the deployed endpoint.** `evals/run.ts` is now an HTTP client of
   `/api/chat` and nothing else — no system prompt, no mode classifier, no `retrieve()` call
   of its own. The endpoint reports what it actually did (`X-Coach-Mode`, `X-Coach-Docs`,
   `X-Coach-Nodes`, `X-Coach-Build`), and the harness scores that. Rerank/similarity SCORES
   are deliberately not exposed: they would be a live readout for tuning text past the
   off-topic gate. `X-Coach-Build` never guesses — a Vercel instance that cannot name its
   commit says `vercel-nogit`, and the runner refuses to attribute that report to a change.

   **First real baseline: `evals/reports/2026-07-13T19-36-20-endpoint-baseline.*`**, 30
   queries against `coach.tamasdemeter.com` running build `0adb25f`. What the shadow app got
   wrong, and what it got right by luck, is tabulated in `evals/reports/README.md`. Summary:

   - **Faithfulness 0.828** (shadow said 0.745). The shadow UNDERSTATED the app — its prompt
     had no vocab primer and an 800-token ceiling against the app's 2,500. Clears the ≥0.80
     soft floor for the first time, on a number that finally describes the app.
   - **Contradictions 0/95 after adjudication** (1 raw). The single flagged contradiction was
     the judge faulting the app for saying "Execute Sub-workflow" where the gold fact said
     "Execute Workflow" — n8n renamed the node, the app cited the correct docs URL, the
     ORACLE was stale. Label fixed in `queries.json`; that row re-measures 4s/0p/0u/**0c**.
     The hard safety gate holds — but note it was never actually being measured before.
   - **Recall@5 0.778 / MRR@5 0.657** — bit-identical to the shadow report. Not vindication:
     retrieval is deterministic and the gold set never exercises the one path where the two
     diverge (a bare workflow paste with no prose). Still below the 0.85 exit gate.
   - **Citation validity 0.818 = 36/44 links.** The old 0.785 was a mean of PER-QUERY rates,
     an estimator that scores a perfect 1.0 for an answer that cites nothing — so it rewarded
     the app for refusing. Per link, the old run was 0.824. **8 of 44 emitted docs.n8n.io
     links (18%) still point at URLs that are not in the corpus.** Real, live, unchanged.
   - **Mode-routing 0.933 (28/30). The two failures are both off-topic queries that reached
     doc-grounded ANSWER mode** — a generic Python question and a "how does n8n compare to
     Zapier" question. Off-topic refusal rate is 3/5. The porous-threshold note below is now
     a measured fact, not a worry.

   Three metric-integrity bugs in the new harness were caught by a `/code-review high` pass
   before it shipped: the citation mean that rewarded refusals; a silently-ignored `--no-gen`
   that would have spent real money on production off a command believed to be free; and a
   gate refusal the runner did not understand being written up as a full report instead of
   aborting.

## Still open (each its own session)

5b. **Rotate the shared `claudecode` secret key.** GATED ON OWNER — not yet done. The coach
   no longer uses it, but that key sat in a public app's Vercel env for 81 days, and root
   `.env` carries the same value. Rotation is estate-wide (root `.env`, VPS agents,
   ops-dashboard, website), so it is zero-downtime only if done as mint-new → roll every
   consumer → verify green → delete old. Enumerate consumers before touching anything.

6b. **What the first honest run surfaced.** Not a blocker for fix 7, but this is what stands
   between these numbers and a public quality claim:
   - **REAL DEFECT: 18% of emitted doc links are not in the corpus** (8 of 44). The model
     writes plausible `docs.n8n.io` URLs it cannot ground. A prospect who clicks one gets a
     404 from the demo that is supposed to prove the retrieval works. Cheap fix: strip or
     rewrite any link not in `data/corpus.json` post-generation. Honest fix: stop the model
     inventing URLs at all — make it cite by source index and resolve the URL server-side.
   - **NOT a defect: the 2 mode-routing "failures" are label disputes, not leaks.** Both
     off-topic queries that reached ANSWER mode produce CORRECT output. `rdr-03` ("read a CSV
     in Python") answers only the n8n part and says so — exactly what `BASE_SYSTEM` instructs
     for a partially-n8n question. `rdr-04` ("Zapier or Make instead of n8n?") routes to
     answer mode and then refuses in prose anyway. The 2026-05-25 session called this label
     noise and was right. The residual cost is **COGS, not safety**: both spend a retrieval +
     a full answer-mode Sonnet call to produce what the cheap redirect path would have.
     Mode accuracy 0.933 is therefore bounded by contested labels, not by app behaviour —
     and the labels must not be quietly rewritten to flatter the metric.

7. **Technical Journal re-skin + UX fixes.** Retire the dark/Instrument-Serif theme for the
   bone+pine brand. UX debt from the impeccable audit (18/40): the `<h1>` masthead is wired
   to `resetChat` (clicking the "logo" silently wipes the transcript); no stop/abort on a
   streaming generation; no retry after an error; no `aria-live` on the answer region; the
   4-chip empty state is a banned identical-card grid. Biggest opportunity: make the
   retrieval visible (cited sources, routed mode, parsed node count) so a prospect sees the
   machinery, not a generic chat box.

## Residual notes

- Off-topic gate threshold (0.25 sim / 0.30 rerank) is porous at the margin. **No longer a
  worry — measured: 2 of the 5 off-topic gold queries reach doc-grounded ANSWER mode.** The
  answer prompt still refuses to leave n8n, so it is not a free-LLM proxy, but it is spending
  a full Sonnet call on questions it should refuse for free. Now tracked as 6b.
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
