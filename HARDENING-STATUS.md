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

## Still open (each its own session)

5. **Own Supabase project + rotate the key.** The app still holds
   `SUPABASE_SERVICE_ROLE_KEY` for the SHARED business project `lxxkxqhriunbouvkzncj`
   (CRM, agents). Stand up a dedicated free-tier project, dump/restore the `coach_*` schema
   (5 tables + these functions), move the app env, then DELETE + ROTATE the shared key.
   Note: the spend-ceiling migration was applied to the shared project, so it comes along
   in the dump/restore.

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
