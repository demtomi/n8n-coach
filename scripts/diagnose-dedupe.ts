/**
 * The real bottleneck, tested.
 *
 * Pool recall@50 is 0.96 but recall@5 is 0.80, so the gold page is a CANDIDATE and the top-5
 * cut is what loses it. And the cut is being spent badly: chunking (D2) means several chunks
 * of the SAME page can occupy several of the five slots -- dbg-05 spent two slots on
 * code__common-issues chunks 1 and 2, ans-17 spent two on sheet-operations chunks. Every
 * duplicated page is a slot the gold page did not get, and a duplicated page in the prompt is
 * also context we pay for twice.
 *
 * So: keep 5 distinct PAGES instead of 5 chunks (best-ranked chunk wins the page's slot).
 * Same reranker, same pool, no new model, no new API. This measures whether that alone
 * recovers the four rows the reranker is dropping.
 *
 * Throttled: the Voyage rerank TPM ceiling (2M/min) is real, and a 50-doc rerank is ~40k
 * tokens, so an unthrottled sweep trips 429 halfway and reports a partial result as if it
 * were the whole one.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
loadEnv({ path: path.join(process.cwd(), ".env.local") });

import { db, num } from "../lib/db";
import { rerank } from "../lib/rerank";
import { detectWorkflow, semanticQueryFor } from "../lib/debug-mode";

const POOL = 50;
const TOP_K = 5;
const pageOf = (id: string) => id.replace(/__c\d{2,}$/, "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Q = { id: string; query: string; mode: string; expected_doc_ids: string[] };
type Row = { id: string; title: string; content: string; similarity: number };

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
  return ((await res.json()) as { data: Array<{ embedding: number[] }> }).data[0].embedding;
}


function score(ids: string[], gold: string[]) {
  const pages = [...new Set(ids.map(pageOf))];
  const recall = gold.filter((g) => pages.includes(g)).length / gold.length;
  const mrr =
    gold.reduce((a, g) => {
      const i = pages.indexOf(g);
      return a + (i >= 0 ? 1 / (i + 1) : 0);
    }, 0) / gold.length;
  return { recall, mrr };
}

async function main() {
  const queries: Q[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evals/queries.json"), "utf8")
  ).queries;
  const rows = queries.filter((q) => q.expected_doc_ids.length && q.mode !== "redirect");

  let aR = 0,
    aM = 0,
    bR = 0,
    bM = 0;
  const fixed: string[] = [];
  const broke: string[] = [];

  for (const q of rows) {
    // OLD derivation: the prose around the JSON (what shipped until now).
    const wf = detectWorkflow(q.query);
    const oldText = wf ? wf.remainder || "debug this n8n workflow" : q.query;
    // NEW derivation: prose + the node types actually in the workflow.
    const newText = semanticQueryFor(q.query);

    const run = async (text: string) => {
      const vec = JSON.stringify(await embed(text));
      const pool = await db()<Row[]>`
        select id, title, category, docs_url, github_url, content, similarity
        from coach_match_documents(${vec}::vector, ${num(POOL)}::int)`;
      const ranked = await rerank(text, pool.map((p) => `${p.title}\n\n${p.content}`), POOL);
      const order = ranked.map((r) => pool[r.index].id);
      const top5 = order.slice(0, TOP_K);
      const deduped: string[] = [];
      for (const id of order) {
        if (deduped.some((d) => pageOf(d) === pageOf(id))) continue;
        deduped.push(id);
        if (deduped.length === TOP_K) break;
      }
      return { top5, deduped };
    };

    const before = await run(oldText);
    await sleep(3000);
    const after = oldText === newText ? before : await run(newText);

    const deployed = before.top5;
    const A = score(deployed, q.expected_doc_ids);
    const B = score(after.deduped, q.expected_doc_ids);
    aR += A.recall;
    aM += A.mrr;
    bR += B.recall;
    bM += B.mrr;
    if (B.recall > A.recall) fixed.push(q.id);
    if (B.recall < A.recall) broke.push(q.id);

    const dupes = TOP_K - new Set(deployed.map(pageOf)).size;
    console.log(
      `${q.id.padEnd(32)} recall ${A.recall.toFixed(2)} -> ${B.recall.toFixed(2)}   wasted slots: ${dupes}`
    );
    await sleep(3000); // stay under the 2M-tokens-per-minute rerank ceiling
  }

  const n = rows.length;
  console.log(
    `\n              recall@5   MRR@5\n` +
      `deployed              ${(aR / n).toFixed(4)}     ${(aM / n).toFixed(4)}\n` +
      `node-types + dedupe   ${(bR / n).toFixed(4)}     ${(bM / n).toFixed(4)}\n\n` +
      `fixed by dedupe : ${fixed.join(", ") || "none"}\n` +
      `broken by dedupe: ${broke.join(", ") || "none"}`
  );
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
