# Phase B — Execution Plan (n8n Workflow Coach v2)

> **Companion to** `plan.md` § Phase v2 → Phase B
> **Drafted:** 2026-05-14
> **Status (2026-05-25):** Small-slice SHIPPED — **B2 caching + B4 eval harness scaffold + B5 Lighthouse setup**. B1 (rerank) and B3 (hybrid) deferred to next session. Decision log entries below capture the Q1-Q7 resolutions.
> **Pick-up state:** v1 LIVE at `coach.tamasdemeter.com` (DNS restored 2026-05-25). Embeddings on `voyage-4`. Reranker still pending. Cache_control wired on system prefix (vocab primer + base/debug rules, ~2,160 tokens). Eval harness boots end-to-end against live retrieve(); 3-query smoke run passed (mode-routing 3/3, recall@5 1.00 on ans-01).

## Decision log (2026-05-25 small-slice)

- **Q1 Caching scope:** Option A locked. `lib/cache-padding.ts` holds the static n8n vocab primer (~1,833 tokens). Combined with `BASE_SYSTEM` (~330) or `DEBUG_SYSTEM` (~280) the cached prefix is ~2,110-2,160 tokens, safely above Sonnet 4.6's 2,048-token cache floor. Retrieved docs flow as a second uncached system block. Redirect mode stays uncached (one-shot, short prompt).
- **Q2 Gold-set queries:** fabricated. 30 queries in `evals/queries.json` — 20 answer (mix of beginner / intermediate / advanced / common-gotcha), 5 debug (real workflow JSON with planted errors: merge-by-key field mismatch, infinite pagination, webhook respond mode, IF type coercion, code-node self-reference), 5 redirect (weather / forex / Python / Zapier compare / recipe). Faithfulness uses STUB scorer (keyword-overlap heuristic) — LLM-judge upgrade still open.
- **Q3 Threshold retune after B1:** approved without re-asking; new threshold lands in `plan.md` decision log when B1 ships.
- **Q4 Supabase migration auth:** Management API via DTS PAT, same project (`lxxkxqhriunbouvkzncj`) and pattern as the v1 `coach_chatbot_v1_tables` migration. No new credential needed; will execute when B3 lands.
- **Q5 Lighthouse target URL:** AUTO-RESOLVED — DNS for `coach.tamasdemeter.com` restored 2026-05-25 (Cloudflare API CNAME, see `reference/api-references/cloudflare-api.md`). First Lighthouse run captured at `docs/lighthouse/2026-05-25T18-48-32-mobile.{html,json}`.
- **Q6 Exit-gate revision:** DEFERRED — decide after first full baseline run with generation enabled.
- **Q7 Session scope:** small slice (~2h actual) — B2 + B4 scaffold + B5 setup shipped. B1 + B3 + full baseline run on next session.

## Lighthouse baseline (mobile, 2026-05-25, coach.tamasdemeter.com)

| Category | Score |
| --- | --- |
| Performance | 94/100 |
| Accessibility | 100/100 |
| Best Practices | 100/100 |
| SEO | 100/100 |

| Core Web Vital | Value | Score |
| --- | --- | --- |
| LCP | 3.0s | 78/100 |
| CLS | 0 | 100/100 |
| TBT | 80ms | 99/100 |
| FCP | 0.8s | 100/100 |
| Speed Index | 2.8s | 96/100 |
| Time to Interactive | 3.0s | 96/100 |

**Verdict:** CLS, accessibility, FCP all clean. **LCP 3.0s misses the <1.5s target** — log and defer per plan §B5 ("resist Phase B fix; punt to Phase A4 landing polish"). The image / hero / initial Tailwind hydration is the likely cause; tackle alongside merchandising work.

## Next-session start

1. Re-run full eval baseline with `npm run eval` (generation enabled, ~$0.30 cost) → write `evals/reports/<stamp>-baseline.md` as the pre-rerank reference.
2. B1 Voyage rerank-2.5 — wrapper at `lib/rerank.ts`, top-50 from RPC → rerank to top-5, plumb `relevance_score` through `RagResult`. Re-tune `OFF_TOPIC_THRESHOLD` on rerank score.
3. B3 hybrid search — Supabase migration adds `ts_vector` column + GIN + RRF RPC. Switch `lib/rag.ts::retrieve` to call hybrid RPC.
4. Re-run eval as `<stamp>-post-b1.md` and `<stamp>-post-b3.md`. Decide Q6 (exit-gate revision) from the deltas.

---

## Current state snapshot (verified before drafting)

| Surface | State | Source |
|---|---|---|
| Embedding model | `voyage-4` (1024-dim, document/query pair) | `scripts/embed-corpus.ts:50`, `lib/rag.ts:34` |
| Reranker | none — pure vector top-5 via `coach_match_documents` RPC | `lib/rag.ts:45-53` |
| Retrieval | `embedQuery → rpc coach_match_documents(query_embedding, match_count=5)` | `lib/rag.ts` |
| System prompt | string-form (not array) — caching NOT possible at the SDK call site | `app/api/chat/route.ts:88-94` |
| Model | `claude-sonnet-4-6` via `@ai-sdk/anthropic@3.0.71` + `ai@6.0.168` | `package.json`, `route.ts:89` |
| BASE_SYSTEM size | ~330 tokens. Sonnet 4.6 minimum cache block is **2,048 tokens** — this is below the floor | measured against the rules in `reference/api-references/anthropic-api.md` § Prompt caching |
| Corpus | 332 docs, one-chunk-per-doc, `coach_documents` table | `data/corpus.json`, embed script |
| Lighthouse score | never measured | `plan.md` acceptance criteria still unchecked |
| Mobile sign-off | never measured on physical device | same |
| Eval harness | none | grep `evals/` returns nothing |

---

## Ship order (recommended)

The plan.md lists tasks B1-B5 in roughly logical order, but Tamas should ship in **risk-ascending** order, not list order. Recommended sequence:

1. **B5 — Mobile + Lighthouse sign-off** (XS, verification-only, zero code risk). Run this first. Tells us if Phase B even has a Lighthouse problem to solve.
2. **B2 — Prompt caching** (S, additive). Pure refactor of one file (`route.ts`). No schema change. Quickest measurable cost win. **But** has a design gotcha (see § B2 detail).
3. **B4 — Eval harness** (M). MUST land before B1 or B3, because retrieval-quality changes from rerank/hybrid are unprovable without a baseline corpus and gold set.
4. **B1 — Voyage rerank-2.5** (S). Drop-in addition between retrieve and formatContext. Eval harness from B4 measures the delta.
5. **B3 — Hybrid search** (M). Schema change + RPC change + re-embed step. Highest risk. Eval harness scores the gain.

Rationale: shipping B1 or B3 without B4 means "we added a reranker, hope it's better." That's the opposite of `feedback_research_before_recommending.md`. B4 is the measurement instrument; install before swinging the hammer.

**Total time estimate (Claude-assisted, biased small per `feedback_effort_estimates.md`):** 6-8h actual work for all five threads. Plan.md says 8-10h — closer to the upper bound if eval-harness corpus design eats more than 2h.

---

## Thread B5 — Mobile + Lighthouse sign-off

**Size:** XS (30-45 min)

**Scope:** Verify the unchecked v1 acceptance criteria. No code unless Lighthouse surfaces a regression worth fixing in Phase B (defer larger CLS/LCP problems to Phase A or after Phase C).

**Files touched:** none (verification only). Optional: `docs/lighthouse-2026-05-XX.png` for the screenshot artifact.

**Dependencies:** none. DNS broken for `coach.tamasdemeter.com` (separate user action) — run Lighthouse against the working Vercel alias instead. Note in the screenshot filename.

**Risk:** low. The only risk is discovering a real problem and getting tempted to fix it inside Phase B. Resist — log it, defer to Phase A4 (Loom + landing polish).

**How to verify:**
- Lighthouse run on `/` returns LCP < 1.5s, CLS < 0.1, no accessibility errors
- Physical iPhone test: no horizontal scroll on 375px, debug-mode JSON paste works, chat input doesn't trigger zoom

**Time estimate:** 30-45 min including Lighthouse run + screenshot capture + mobile pass.

---

## Thread B2 — Prompt caching

**Size:** S (60-90 min) — design gotcha is real but contained

**Scope:** Move system prompt from string form to array form with `cache_control: ephemeral` on the last block. Convert `streamText({ system: "..." })` to use the AI SDK's array shape via the Anthropic provider.

**Files touched:**
- `app/api/chat/route.ts` — only file in scope
- (optional) `lib/cache-padding.ts` — new, if we decide to pad the system block to the 2,048-token floor

**Dependencies:** none

**Risk: HIGH design risk that plan.md missed.**

The Sonnet 4.6 minimum cacheable block is **2,048 tokens** (verified `anthropic-api.md`). Current state:
- `BASE_SYSTEM`: ~330 tokens
- `DEBUG_SYSTEM`: ~280 tokens
- `REDIRECT_SYSTEM`: ~80 tokens
- Retrieved docs (5 chunks): variable, typically 1,500-4,000 tokens

Single naive cache breakpoint on the system string alone will silently NOT cache (block too small, no error). Three real options:

**Option A: Pad the system prompt with stable boilerplate to 2,048 tokens.**
- Add a static "n8n vocabulary primer" block (node types, common terms) after the rules. Padding stays identical across calls so it caches cleanly.
- Pro: one breakpoint, stable, easy to reason about
- Con: extra ~1,700 tokens of cost on cache-miss writes (1.25× $0.000003 = pennies)

**Option B: Cache system + retrieved-docs together as one block.**
- Place breakpoint after `<retrieved_docs>`. Since the retrieval result is query-dependent, **cache hit rate would be near zero** in normal use — only repeated identical queries within 5min hit. NOT recommended.

**Option C: Don't cache; defer to Phase C when tools are added.**
- Phase C introduces a tool-use loop. Tools array is static. Caching `tools` + system together easily clears 2,048 tokens. This is the natural caching surface.
- Pro: no padding hack
- Con: delays the cost win to Phase C

**Recommendation:** Option A. Build the padding once, leave it in place through Phase C. The padding becomes a useful "n8n vocabulary" prefix anyway — and Phase C tools will stack on top of it.

**Cache-hit estimation:**
- v1 traffic pattern: low (portfolio piece, sparse usage). Hit rate within 5min TTL probably 10-30% in steady state, near-100% during Loom demo or proposal review session.
- Post-Phase-C: tools array stays constant per request, padded system stays constant. Hit rate dominated by the first request "warming" the cache for follow-ups. Estimate 40-60% steady-state.
- Cost delta: cache reads are 0.1× base. System+padding writes once at 1.25× then reads at 0.1× for 5min. On a Loom demo with 6 back-to-back queries: 1 write + 5 reads ≈ 60% cost reduction on system tokens.

**How to verify:**
- Curl two identical queries 30s apart. Inspect `cache_creation_input_tokens` (call 1) → `cache_read_input_tokens > 0` (call 2)
- AI SDK exposes `usage` from `streamText`. Log it.
- Add `console.log('[cache]', usage)` in the `onFinish` callback

**AI SDK v6 specifics:** `@ai-sdk/anthropic` accepts `providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } }` on individual message/content blocks. Confirm exact shape against the SDK's `node_modules/@ai-sdk/anthropic/dist/` source before writing — per `AGENTS.md` "this is NOT the Next.js you know" the same applies to AI SDK v6, which has breaking changes from v5.

**Temperature note:** keeping temperature at 0.3 (current). Per `feedback_llm_extraction_pipeline.md`, even `temperature: 0` is probabilistically deterministic, not bit-deterministic. Caching is orthogonal to determinism — same input + cache hit can still produce different output tokens. Don't oversell.

**Time estimate:** 1h. 30 min for padding design + array conversion, 20 min for verification, 10 min slack.

---

## Thread B4 — Eval harness

**Size:** M (3-4h) — biggest thread, but unblocks all retrieval-quality work

**Scope:** Build a labeled gold-set of 30 queries spanning the three modes (answer, debug, off-topic), score each retrieval run, output a markdown report + JSON for version control.

**Files touched (all new):**
- `evals/queries.json` — 30 labeled queries with `expected_doc_ids` + `expected_facts`
- `evals/run.ts` — runner: hits `retrieve()`, optionally hits Claude for the answer, scores
- `evals/scorers.ts` — retrieval@5 (set overlap), faithfulness (LLM-judge), citation-validity (URL exists in corpus)
- `evals/report-template.md` — markdown template
- `evals/reports/2026-05-XX-baseline.md` — first report
- `package.json` script: `"eval": "tsx evals/run.ts"`

**Dependencies:** Must run BEFORE B1 (rerank) and B3 (hybrid) so the gain is measurable.

**Risk:**
- Gold-set quality determines whether the eval signal is real. 30 queries hand-labeled with `expected_doc_ids` is the load-bearing piece.
- LLM-judge for faithfulness can disagree with reality. Bias toward conservative judge prompts; sample-verify 3-5 results per `feedback_heuristic_false_positives.md`.
- Cost: 30 queries × (1 retrieve + 1 generation + 1 LLM judge) ≈ 90 Claude calls per eval run. At Sonnet 4.6 pricing ≈ $0.30 per full run. Fine for hand-runs, not for CI.

**Gold-set sources (recommended mix):**
- 10 questions from the v1 system prompts + sample prompts (already vetted as on-topic)
- 10 "real" questions Tamas has answered in Skool / DMs / client calls (Tamas's input needed — see Open Q3)
- 5 off-topic decoys (weather, forex, generic Python — should redirect cleanly, retrieval@5 N/A but `mode=redirect` check)
- 5 debug-mode workflows (parseable JSON with planted errors — should fire debug path)

**Metrics:**
- `retrieval@5` — Set overlap: does `expected_doc_ids` ⊆ top-5 returned IDs? (recall at k=5)
- `mrr@5` — Mean reciprocal rank: position of first relevant doc. Catches "right doc but at rank 5" vs "right doc at rank 1"
- `faithfulness` — LLM-judge: "does the response only use facts from the cited sources?" Yes/No/Partial
- `citation-validity` — URL parse → check against `coach_documents.docs_url`
- `mode-routing` — Did off-topic queries get `mode=redirect`? Did debug queries get `mode=debug`?

**Note on LLM-judge determinism:** Same input + same prompt + same temperature can still differ on Claude. Run judge 3× per query, take majority. Per `feedback_llm_extraction_pipeline.md` — multi-pass consensus is the right architecture from day one, not a bolt-on later.

**How to verify:** `npm run eval` runs in < 5min, writes report file, prints final scores to stdout. Baseline (pre-rerank, pre-hybrid) committed as `evals/reports/2026-05-XX-baseline.md`.

**Time estimate:** 3-4h. Gold-set labeling is the long pole (2h). Runner + scorers are 1h. Report formatting 30m. Plan.md says 4h — fits.

---

## Thread B1 — Voyage rerank-2.5

**Size:** S (60-90 min)

**Scope:** Add `lib/rerank.ts` that wraps `/v1/rerank`. Modify `retrieve()` in `lib/rag.ts` to fetch top-50 from pgvector, then rerank to top-5. Pass both `similarity` (vector) and `relevance_score` (rerank) through to caller for logging and eval.

**Files touched:**
- `lib/rerank.ts` — new
- `lib/rag.ts` — `retrieve()` calls rerank after the RPC, `RagResult` type gains `relevance_score: number`
- `app/api/chat/route.ts` — log line gains `top_rel=` field
- Supabase RPC `coach_match_documents` — change `match_count` default from 5 to 50 (or add new RPC `coach_match_documents_50`), so the rerank input is larger pool

**Dependencies:** B4 eval harness exists, so the gain is measurable.

**Risk:**
- **Latency.** Reranker adds ~50-150ms warm. Plan.md risk table flags this. If > 200ms added, fall back to `rerank-2.5-lite`.
- **Cost.** Reranker priced at $0.05/M tokens. 50 docs × ~300 tokens avg + query = ~15K tokens per query = $0.0008/query. Negligible at portfolio traffic.
- **Off-topic gate semantics shift.** Current `OFF_TOPIC_THRESHOLD = 0.25` is on vector similarity. After rerank, the gate should use `relevance_score` instead (different distribution — rerank-2.5 scores are typically 0.0-1.0 with sharper separation). Re-tune threshold against the eval gold-set. Plan.md decision log already has prior threshold-tuning notes for `voyage-3` → `voyage-4` — extend that pattern.

**How to verify:**
- Eval harness reports `retrieval@5` and `mrr@5` improve vs baseline (target: +5-10pp recall@5, MRR improvement of similar magnitude)
- p50 TTFT measurement before/after — accept up to +200ms; investigate if higher
- Off-topic gate still cleanly separates on/off-topic on the 5 decoy queries

**Per Voyage API doc:** request shape is `{query, documents: [...], model: "rerank-2.5", top_k: 5}`. Response sorted desc by `relevance_score`, `index` references input array.

**Time estimate:** 1h. 20m for the wrapper, 15m for the RPC change, 15m for `retrieve()` rewiring, 10m for threshold retune.

---

## Thread B3 — Hybrid search

**Size:** M (2-3h)

**Scope:** Add a `tsvector` column to `coach_documents`, GIN index, hybrid retrieval RPC that merges BM25 (Postgres `ts_rank`) with cosine similarity using a tunable `alpha`.

**Files touched:**
- Supabase migration `coach_chatbot_v2_hybrid_search` — adds `ts_vector` column, GIN index, new RPC `coach_hybrid_match(query_text, query_embedding, k_each, alpha)`
- `scripts/embed-corpus.ts` — backfill `to_tsvector('english', title || ' ' || content)` on existing rows (one-time SQL update; no re-embed)
- `lib/rag.ts` — `retrieve()` switches from `coach_match_documents` to `coach_hybrid_match`
- `evals/reports/2026-05-XX-hybrid.md` — baseline + hybrid comparison

**Dependencies:** B4 eval harness exists. B1 reranker landed (hybrid feeds top-50 candidates into the same reranker).

**Risk:**
- **Postgres `english` text-search config is English-only.** n8n corpus is English — fine. If Hungarian content ever lands (idea #018 hints at multilingual), this needs revisiting.
- **`alpha` tuning.** Naive: weighted sum of `ts_rank * alpha + cosine_similarity * (1-alpha)`. Better: reciprocal rank fusion (RRF) — score-distribution-agnostic. Recommend RRF over weighted sum for robustness.
- **Schema migration is non-destructive** (add column, backfill, add index) — can be rolled back. But it's a real Supabase change requiring auth as project owner. Snapshot state before.
- **n8n node-name lookups** ("Merge node") are the hybrid-win case. Pure vector retrieval often misses exact-keyword matches. RRF should fix this — that's the litmus test.

**How to verify:**
- 5 queries from eval gold-set tagged `lookup_intent` (exact node-name lookups) return correct chunk in top-3
- Overall `retrieval@5` does not regress on non-keyword queries
- Eval report shows RRF vs vector-only vs BM25-only side-by-side

**RPC shape (RRF, recommended):**
```sql
CREATE FUNCTION coach_hybrid_match(
  query_text text,
  query_embedding vector(1024),
  match_count int DEFAULT 50,
  rrf_k int DEFAULT 60
) RETURNS TABLE (id text, title text, ..., rrf_score float) AS $$
  WITH vector_hits AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> query_embedding) AS rank
    FROM coach_documents
    ORDER BY embedding <=> query_embedding LIMIT match_count
  ),
  bm25_hits AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank(ts_vector, plainto_tsquery('english', query_text)) DESC) AS rank
    FROM coach_documents
    WHERE ts_vector @@ plainto_tsquery('english', query_text)
    ORDER BY rank LIMIT match_count
  )
  SELECT d.id, d.title, ..., COALESCE(1.0/(rrf_k + v.rank), 0) + COALESCE(1.0/(rrf_k + b.rank), 0) AS rrf_score
  FROM coach_documents d
  LEFT JOIN vector_hits v USING(id)
  LEFT JOIN bm25_hits b USING(id)
  WHERE v.rank IS NOT NULL OR b.rank IS NOT NULL
  ORDER BY rrf_score DESC
  LIMIT match_count;
$$ LANGUAGE sql STABLE;
```

**Time estimate:** 2-3h. 45m migration + backfill + index, 45m RPC tune, 30m `lib/rag.ts` rewire, 30m eval run + tune `alpha` or `rrf_k`.

---

## DO NOT DO (rejected scope creep)

- **n8n-docs corpus refresh** — Phase D2. Don't fold into Phase B even though "while we're in there" is tempting. Phase B is about retrieval quality on the existing corpus.
- **Re-embedding to `voyage-4-large` for higher recall** — Costs 2× ($0.12/M vs $0.06/M), no schema change at 1024-dim but a non-trivial re-embed run. Wait until eval harness proves voyage-4 is the ceiling. Voyage-4 is the recommended default already.
- **Output_dimension increase to 2048 (Matryoshka)** — Requires pgvector column type change → full re-index. Wait for evidence that 1024-dim is the bottleneck.
- **Switch to `rerank-2.5-lite` preemptively** — Plan-table mitigation already says "fall back if > 200ms added." Don't preempt; measure first.
- **Replace pgvector with Pinecone or dedicated vector DB** — Per `business/automations-lab/CLAUDE.md` open architecture decision: "Do NOT add Pinecone / Redis / Elasticsearch without measured Postgres failure." pgvector + GIN handles this scale.
- **Multi-turn chat context caching** — Phase D1 (session memory) introduces the conversation history that would benefit. Caching the conversation prefix waits until that table exists.
- **TypeScript expression parser** — Phase C2. Belongs to the validator, not Phase B.
- **Vercel Edge runtime swap for lower latency** — Current is `nodejs` runtime. Edge gets ~100ms cold-start win but breaks the Supabase service-role auth pattern + module-init bug history. Out of scope. If latency budget gets tight after rerank lands, revisit then.
- **Dark mode / theme work** — Not in v1 acceptance criteria. Plan.md "Out of scope" list still applies.

---

## Open questions for Tamas (numbered)

1. **Caching scope decision.** Option A (pad system to 2,048 tokens with n8n vocabulary block) vs Option C (defer caching to Phase C tools+system)? I recommend A because the padding doubles as a useful n8n primer block, and it ships the cost-win earlier. Confirm before B2 starts.
2. **Eval gold-set query input.** I can seed 20 queries from sample prompts + invented "real" questions. But 10 of the 30 should be questions you've actually answered in Skool/DMs/calls — paste 10 here and I'll label them, or point me to a chat log to pull from?
3. **Threshold retune after B1.** Current `OFF_TOPIC_THRESHOLD = 0.25` is on vector similarity. After rerank lands, the gate should switch to `relevance_score`. OK to retune against the eval gold-set without re-asking? Plan.md decision log will record the new threshold.
4. **Supabase migration auth.** Phase B3 needs a real Supabase migration applied. Confirm I have the access pattern — apply via Supabase MCP / dashboard / migration file checked in via CLI?
5. **Lighthouse / Vercel alias.** DNS for `coach.tamasdemeter.com` still broken (6 days past 2026-05-08 break). Run Lighthouse against the working Vercel alias for now? Or block B5 until DNS lands? I'd run against the alias and screenshot it — the score is the same, the URL in the screenshot just looks different.
6. **Phase B exit gate.** Plan.md says "retrieval@5 ≥ 0.85, faithfulness ≥ 0.95." Targets are reasonable but the first baseline run might show we're already above 0.85 with pure vector — in which case rerank + hybrid become diminishing-returns work. OK to revise targets up after baseline?
7. **Time budget for this session.** Plan.md says Phase B is 8-10h. If you want a meaningful slice now, B5 (XS) + B2 design + B4 query labeling (start) is ~2h. Want me to start any of that, or hold until you sign off on the plan?

---

## Phase B exit gate (unchanged from plan.md, restated for convenience)

- `evals/run.ts` reports retrieval@5 ≥ 0.85, faithfulness ≥ 0.95 on a 30-query labeled set
- Prompt-cache hit verified via two-back-to-back logs showing `cache_read_input_tokens > 0`
- All B1-B5 tasks ticked
- Commit + push to `demtomi/n8n-coach`
- Update `plan.md` § Phase B with actuals vs estimates per `feedback_build_time_tracking.md`
- Update this file's status header to "shipped" + decision log entry

---

## Audit note (per `feedback_audit_plan_before_commit.md`)

Senior-architect lens applied:

- **Duplicate truth sources:** none. `plan.md` is the master, this file is the execution layout. No state lives in both.
- **Regression risk:** B2 (system → array form) and B3 (RPC change in `lib/rag.ts`) both touch live code paths. Eval harness from B4 protects against silent regression. Sequence enforces this.
- **Cron conflicts:** none. No cron jobs added or modified in Phase B.
- **Missing migration steps:** B3 has a Supabase migration. Backfill script for `ts_vector` is in scope.
- **PII / secrets:** none — corpus is public n8n docs, no client data. Pre-commit scan still required per `feedback_pii_and_secrets_gitignore.md`.
- **CLAUDE.md drift:** when Phase B ships, update `business/automations-lab/builds/n8n-coach-chatbot/CLAUDE.md` § Status to reflect new pickup state. Don't let docs lag code (per `feedback_promote_decisions_to_source_of_truth.md`).

Business-operator lens:

- **Cost.** Eval runs add ~$0.30/run during dev. Reranker adds ~$0.0008/query in prod. Both within the $20/mo ceiling.
- **Time to value.** B5 + B2 ship measurable wins in <2h. Don't gate the small wins behind the eval-harness build.
- **Sales surface.** Phase A (merchandising) waits on Phase C — but a Phase-B-only artifact ("we added a reranker and hybrid search, here's the eval report") is already a credible Upwork proposal point. Don't wait for C to start linking from proposals.
