# CLAUDE.md — n8n Workflow Coach

> **Parent:** `../../CLAUDE.md` (automations-lab)
> **Last updated:** 2026-05-25 (Phase B small-slice SHIPPED — B2 prompt caching + B4 eval harness scaffold + B5 Lighthouse setup. **B2:** `lib/cache-padding.ts` (~1,833-token n8n vocab primer) + `app/api/chat/route.ts` rewired to `SystemModelMessage[]` with `cacheControl: ephemeral` on the primer+rules block (~2,160 tokens, above Sonnet 4.6's 2,048 cache floor); `onFinish` logs `cache_write` / `cache_read`. **B4:** `evals/queries.json` (30 fabricated queries — 20 answer / 5 debug / 5 redirect) + `evals/scorers.ts` (recall@5, MRR@5, mode-routing, citation-validity, faithfulness STUB) + `evals/run.ts` (runner with `--no-gen` / `--ids=` flags, writes Markdown + JSON to `evals/reports/`) + `npm run eval` script. Smoke run 3/3 mode-routing correct, recall@5=1.00 on ans-01-merge-modes. **B5:** `lighthouse` + `chrome-launcher` devDeps + `scripts/lighthouse.mjs` + `npm run lighthouse`. First run captured at `docs/lighthouse/2026-05-25T18-48-32-mobile.{html,json}` — **94/100/100/100/100** (perf/a11y/best-practices/SEO); CLS=0, TBT=80ms, FCP=0.8s clean; **LCP=3.0s misses <1.5s target** — logged + deferred to Phase A4 landing polish per plan §B5. Deps added: `@anthropic-ai/sdk` + `dotenv` (runtime), `lighthouse` + `chrome-launcher` (dev). Decisions locked: Q1 Option A (vocab-primer padding), Q2 fabricated gold-set, Q3 retune-without-asking approved, Q4 Supabase Management API for B3 migration, Q5 auto-resolved (DNS live), Q6 exit-gate revision deferred to post-baseline. Lint + build clean. **B1 (rerank) + B3 (hybrid) deferred to next session.** Prior 2026-05-25 (earlier today): `coach.tamasdemeter.com` DNS RESTORED via Cloudflare API after 17-day outage; ref doc seeded at `reference/api-references/cloudflare-api.md`. Prior 2026-05-14: Phase B execution plan shipped at `phase-b-execution-plan.md`. Stale ref cleanup: prior `tasks.md` pointer doesn't resolve — task should live in Notion Tasks DB. Repositioning artifact from "RAG chatbot" → "agent that fixes workflows" for Upwork proposal use. Phase order: B (technical) → C (reposition) → D (depth) → A (merchandising last). Idea pointer at `business/automations-lab/ideas/018-n8n-coach-tier2-reposition.md`.)
> **Status:** v1 LIVE at `coach.tamasdemeter.com`. **Phase B small-slice shipped 2026-05-25** (B2 caching + B4 eval scaffold + B5 Lighthouse). **Next session: run full eval baseline with generation (`npm run eval`), then B1 (Voyage rerank-2.5), then B3 (hybrid search RRF).** Live cache_read verification still pending — needs a deployed call (push to Vercel or local dev hit).
> **Repo:** [demtomi/n8n-coach](https://github.com/demtomi/n8n-coach) (public)
> **Case study (Notion, Draft):** https://www.notion.so/34cd0c9d91098148990fca95e6c1a075 — "AI n8n Coach Cuts Student Roadmap Time 35%". Original v1 positioning. **Will rewrite for v2 in Phase A3 after C ships** (validator + agentic + writeback are the new headline, not just "35% faster roadmap").

---

## Source of truth

- **`plan.md`** — full build plan, time log, acceptance criteria, healing patches, decision log. Read first for any task in this folder.
- **`phase-b-execution-plan.md`** — Phase B execution plan shipped 2026-05-14. 5 threads scoped (mobile/Lighthouse, prompt caching, eval harness, rerank-2.5, hybrid search/RRF). Ship order risk-ascending. 6-8h Claude-assisted estimate. 7 open questions for Tamas. Two plan.md errors caught: embedding model already on `voyage-4`, only reranker left for B1; Sonnet 4.6 has 2048-token min cacheable block (BASE_SYSTEM ~330 tokens, naive caching silently fails — recommend Option A pad with n8n vocab primer).
- **`loom-script.md`** — 90s demo beat sheet for the portfolio walkthrough.
- **`README.md`** — public-facing project doc (committed to GitHub).

## Stack

Next.js 16, React 19, Tailwind 4, TypeScript, Vercel AI SDK v6, Claude Sonnet 4.6 (`@ai-sdk/anthropic`), Voyage `voyage-4` embeddings (1024-dim, multilingual), Supabase pgvector.

## Important conventions in this project

- **Nested git repo.** This folder has its own `.git`. The outer `demtomi/claude-code` repo tracks `plan.md`, `loom-script.md`, and the nested `.git` reference only.
- **Local git email:** `dev@tamasdemeter.com` (per-repo config, matches Vercel team-validation requirement).
- **Env vars:** `.env.local` (gitignored). Template at `.env.local.example`. Vercel prod has the same 4 keys: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- **Supabase tables prefixed `coach_*`** to avoid collision with `prospects`, `agents`, etc. in the shared project (`lxxkxqhriunbouvkzncj`).
- **Next.js 16 quirks:** `middleware.ts` → `proxy.ts`, `convertToModelMessages` returns a Promise in AI SDK v6. See `AGENTS.md`.
- **Module-scope env reads break Vercel builds.** Use lazy-singleton pattern for any SDK client (see `lib/rag.ts`, `lib/rate-limit.ts`).

@AGENTS.md
