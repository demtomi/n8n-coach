# n8n Workflow Coach

A chatbot that answers n8n questions and debugs pasted workflow JSON, grounded in the official n8n documentation.

**Live:** [coach.tamasdemeter.com](https://coach.tamasdemeter.com)

Built as a portfolio piece by [Tamas Demeter](https://tamasdemeter.com) over a weekend.

## What it does

- **Answer mode** — Ask any n8n question. Gets an answer with inline citations linking back to `docs.n8n.io`.
- **Debug mode** — Paste an n8n workflow JSON. Gets a structured diagnosis: what it does, what's broken, which node, why it breaks (citing docs), exact fix.
- **Off-topic guardrail** — Ask it "what's the weather in Budapest" and it declines in one sentence rather than hallucinating. Similarity gate keeps it locked to the n8n world.

## Stack

- **Framework** — Next.js 16 (App Router), React 19, Tailwind 4, TypeScript
- **LLM** — Claude Sonnet 4.6 via Vercel AI SDK v6 + `@ai-sdk/anthropic`
- **Embeddings** — Voyage `voyage-3` (1024-dim)
- **Vector store** — Supabase pgvector with HNSW index
- **Corpus** — 332 pages from `n8n-io/n8n-docs` (core-nodes, cluster-nodes, trigger-nodes, workflows, code)
- **Hosting** — Vercel

## Architecture

```
User query
  │
  ▼
┌─────────────────────────────────────┐
│ Extract workflow JSON (if pasted)   │  → Debug mode flag
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Embed query (Voyage voyage-3)       │
│ Cosine similarity in Supabase       │
│ Top-5 matching docs                 │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Route                               │
│  • Debug mode → DEBUG_SYSTEM prompt │
│  • On-topic (sim ≥ 0.25) → BASE     │
│  • Off-topic (sim < 0.25) → REDIRECT│
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ streamText(Claude Sonnet 4.6)       │
│ + smoothStream(word, 15ms)          │
└──────────┬──────────────────────────┘
           │
           ▼
        SSE stream
```

## How it was built

The full build plan, time log, and healing patches live in [`plan.md`](./plan.md). Built in a single weekend sitting using the B.U.I.L.D. framework.

## Run locally

```bash
git clone https://github.com/demtomi/n8n-coach.git
cd n8n-coach
npm install
cp .env.local.example .env.local  # fill in 4 keys
npx tsx scripts/build-corpus.ts   # builds corpus.json from n8n-docs
npx tsx scripts/embed-corpus.ts   # embeds + upserts to Supabase
npm run dev
```

### Required env vars

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
```

### Supabase setup

Apply the two migrations (see `plan.md` § T3 and T10):
1. `coach_chatbot_v1_tables` — tables + pgvector + `coach_match_documents` RPC
2. `coach_rate_limit_fn` — rate-limiting Postgres function

## License

Code: MIT. n8n documentation content is owned by the n8n team (see [n8n-docs license](https://github.com/n8n-io/n8n-docs)).
