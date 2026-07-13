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
- **Embeddings** — Voyage `voyage-4` (1024-dim, multilingual)
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
│ Embed query (Voyage voyage-4)       │
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

Built in a single weekend sitting. The build plan and time log are kept privately.

## Eval

`npm run eval` POSTs the **deployed** `/api/chat` and scores what comes back — it does not
reimplement the app's prompt or router, and it stamps every report with the commit the
endpoint was running. Reports land in [`evals/reports/`](./evals/reports); read that folder's
README before quoting any number, including the ones committed there.

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

See `.env.local.example`. The deployed app carries three:

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
COACH_DATABASE_URL=      # scoped `coach_app` Postgres role, via the Supavisor pooler
```

`COACH_DATABASE_URL` is deliberately NOT a `service_role` key. The app's DB role holds
EXECUTE on exactly three functions and **zero table grants**, so a bug in the public,
unauthenticated endpoint cannot read anything it was not built to read. Do not put a
`service_role` key in app code.

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are admin-only: `scripts/embed-corpus.ts` uses
them from a laptop to build the index. They are not set in production.

### Supabase setup

Apply the migrations in [`migrations/`](./migrations) in filename order. They create the
`coach_*` tables + pgvector + the `coach_match_documents` RPC, the rate-limit / spend-ceiling
functions, and the scoped `coach_app` role the app connects as.

## License

Code: MIT. n8n documentation content is owned by the n8n team (see [n8n-docs license](https://github.com/n8n-io/n8n-docs)).
