/**
 * B3 — pick the hybrid-retrieval weights OFFLINE, before touching the app.
 *
 * Retrieval is deterministic and needs no Anthropic call, so the whole sweep costs cents of
 * Voyage instead of the ~USD 1 a full endpoint eval spends against a real daily ceiling. The
 * winner gets ONE confirmation run through the deployed endpoint; the losers cost nothing.
 *
 * WHAT IT MEASURES, and why recall alone would be a trap:
 *
 *   1. recall@5 / MRR@5 on the page-level gold (the thing B3 is for).
 *   2. GATE FLIPS. app/api/chat/route.ts refuses a query whose top result scores below
 *      OFF_TOPIC_SIM_THRESHOLD (cosine) and OFF_TOPIC_RELEVANCE_THRESHOLD (rerank). Hybrid can
 *      surface a strong LEXICAL hit whose cosine is low -- which drags top-similarity down and
 *      can refuse a legitimate question -- or pull an off-topic query over the line. A weight
 *      set that buys +0.05 recall by silently refusing real users is not an improvement, and
 *      recall would never show it. Every config is therefore scored on whether each query
 *      still routes the way the deployed app routes it today.
 *
 * It calls the REAL rerank() and the REAL detectWorkflow(), not copies of them: a tuner that
 * reimplements the app tunes a shadow of it.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
loadEnv({ path: path.join(process.cwd(), ".env.local") });

import { db, num } from "../lib/db";
import { rerank } from "../lib/rerank";
import { detectWorkflow, semanticQueryFor } from "../lib/debug-mode";

const OFF_TOPIC_SIM_THRESHOLD = 0.25;
const OFF_TOPIC_RELEVANCE_THRESHOLD = 0.3;
const POOL = 50;
const TOP_K = 5;

type Row = {
  id: string;
  title: string;
  category: string;
  docs_url: string;
  github_url: string;
  content: string;
  similarity: number;
};

type Query = {
  id: string;
  query: string;
  mode: "answer" | "debug" | "redirect";
  expected_doc_ids: string[];
};

type Config = {
  name: string;
  hybrid: boolean;
  wVec?: number;
  wLex?: number;
};

const CONFIGS: Config[] = [
  { name: "vector (deployed)", hybrid: false },
  { name: "hybrid 1.0/1.0", hybrid: true, wVec: 1.0, wLex: 1.0 },
  { name: "hybrid 1.0/0.5", hybrid: true, wVec: 1.0, wLex: 0.5 },
  { name: "hybrid 1.0/0.3", hybrid: true, wVec: 1.0, wLex: 0.3 },
  { name: "hybrid 0.7/1.0", hybrid: true, wVec: 0.7, wLex: 1.0 },
];

/** Same page key the eval scorer uses: chunks fold into their page. */
const pageOf = (id: string) => id.replace(/__c\d{2,}$/, "");

async function embed(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: [text], model: "voyage-4", input_type: "query" }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data: Array<{ embedding: number[] }> };
  return json.data[0].embedding;
}

/** What the ENDPOINT sends to retrieval — copied from route.ts's derivation, via its own detectWorkflow. */

async function search(cfg: Config, text: string, embedding: number[]): Promise<Row[]> {
  const vec = JSON.stringify(embedding);
  if (!cfg.hybrid) {
    return db()<Row[]>`
      select id, title, category, docs_url, github_url, content, similarity
      from coach_match_documents(${vec}::vector, ${num(POOL)}::int)
    `;
  }
  return db()<Row[]>`
    select id, title, category, docs_url, github_url, content, similarity
    from coach_hybrid_match(
      ${text}::text, ${vec}::vector, ${num(POOL)}::int,
      ${num(cfg.wVec!)}::float8, ${num(cfg.wLex!)}::float8, ${num(60)}::int
    )
  `;
}

async function main() {
  const queries: Query[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evals/queries.json"), "utf8")
  ).queries;

  // Embed each query ONCE and reuse across configs: the embedding does not depend on the
  // fusion weights, and re-embedding per config would pay for the same vector five times.
  const embeddings = new Map<string, { text: string; vec: number[] }>();
  for (const q of queries) {
    const text = semanticQueryFor(q.query);
    embeddings.set(q.id, { text, vec: await embed(text) });
  }
  console.log(`embedded ${embeddings.size} queries\n`);

  for (const cfg of CONFIGS) {
    let recSum = 0,
      mrrSum = 0,
      scored = 0;
    const flips: string[] = [];
    const misses: string[] = [];

    for (const q of queries) {
      const { text, vec } = embeddings.get(q.id)!;
      const pool = await search(cfg, text, vec);
      if (pool.length === 0) continue;

      const docs = pool.map((p) => `${p.title}\n\n${p.content}`);
      const ranked = await rerank(text, docs, TOP_K);
      const top = ranked.map((r) => ({ ...pool[r.index], relevance_score: r.relevance_score }));

      // The gate, exactly as route.ts computes it.
      const topSim = top[0]?.similarity ?? 0;
      const topRel = top[0]?.relevance_score ?? 0;
      const onTopic =
        topSim >= OFF_TOPIC_SIM_THRESHOLD && topRel >= OFF_TOPIC_RELEVANCE_THRESHOLD;
      const workflow = detectWorkflow(q.query);
      const routed = workflow ? "debug" : onTopic ? "answer" : "redirect";
      // A flip is measured against how the query SHOULD route, so a config that starts
      // refusing real questions is caught even where the deployed app already misroutes.
      if (routed !== q.mode) {
        flips.push(`${q.id}:${q.mode}->${routed}`);
      }

      if (q.expected_doc_ids.length === 0 || q.mode === "redirect") continue;
      const ids = [...new Set(top.map((t) => pageOf(t.id)))];
      const hits = q.expected_doc_ids.filter((g) => ids.includes(g));
      const recall = hits.length / q.expected_doc_ids.length;
      const mrr =
        q.expected_doc_ids.reduce((a, g) => {
          const r = ids.indexOf(g);
          return a + (r >= 0 ? 1 / (r + 1) : 0);
        }, 0) / q.expected_doc_ids.length;
      recSum += recall;
      mrrSum += mrr;
      scored++;
      if (recall === 0) misses.push(q.id);
    }

    console.log(
      `${cfg.name.padEnd(18)} recall@5 ${(recSum / scored).toFixed(4)}  MRR@5 ${(mrrSum / scored).toFixed(4)}  ` +
        `(${scored} rows)  routing-misfits ${flips.length}`
    );
    console.log(`   zero-recall rows: ${misses.join(", ") || "none"}`);
    console.log(`   misroutes       : ${flips.join(", ") || "none"}\n`);
  }

  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
