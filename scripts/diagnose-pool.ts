/**
 * THE DISCRIMINATOR B3 rests on.
 *
 * Retrieval is two stages: a 50-doc POOL (vector, or now hybrid) and a RERANKER that cuts it
 * to 5. A row scores 0.00 recall for one of two completely different reasons:
 *
 *   A. the gold page is NOT IN THE POOL     -> a retrieval problem. Hybrid can fix it.
 *   B. the gold page IS in the pool and the RERANKER drops it -> hybrid CANNOT fix it, and
 *      swapping the retriever would be a change that measures identical and buys nothing.
 *
 * The tuner already hinted at B: hybrid 1.0/1.0 scored bit-identical to vector, which is what
 * you would see if the pool already contained the gold and the reranker was the thing losing
 * it. So measure the pool directly, before spending anything more on weight sweeps.
 *
 * No reranker call, so this costs one embedding per query and nothing else.
 */
import { config as loadEnv } from "dotenv";
import path from "node:path";
import fs from "node:fs";
loadEnv({ path: path.join(process.cwd(), ".env.local") });

import { db, num } from "../lib/db";
import { detectWorkflow, semanticQueryFor } from "../lib/debug-mode";

const POOL = 50;
const pageOf = (id: string) => id.replace(/__c\d{2,}$/, "");

type Q = { id: string; query: string; mode: string; expected_doc_ids: string[] };

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


async function main() {
  const queries: Q[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "evals/queries.json"), "utf8")
  ).queries;
  const rows = queries.filter((q) => q.expected_doc_ids.length && q.mode !== "redirect");

  console.log("row                              gold in VECTOR pool?   gold in HYBRID pool?   rank");
  let vecIn = 0,
    hybIn = 0;

  for (const q of rows) {
    const text = semanticQueryFor(q.query);
    const vec = JSON.stringify(await embed(text));

    const v = await db()<{ id: string }[]>`
      select id from coach_match_documents(${vec}::vector, ${num(POOL)}::int)`;
    const h = await db()<{ id: string }[]>`
      select id from coach_hybrid_match(${text}::text, ${vec}::vector, ${num(POOL)}::int,
        ${num(1)}::float8, ${num(1)}::float8, ${num(60)}::int)`;

    const vPages = v.map((r) => pageOf(r.id));
    const hPages = h.map((r) => pageOf(r.id));
    const inV = q.expected_doc_ids.every((g) => vPages.includes(g));
    const inH = q.expected_doc_ids.every((g) => hPages.includes(g));
    if (inV) vecIn++;
    if (inH) hybIn++;

    const bestRank = Math.min(
      ...q.expected_doc_ids.map((g) => {
        const i = hPages.indexOf(g);
        return i < 0 ? 999 : i + 1;
      })
    );
    console.log(
      `${q.id.padEnd(32)} ${(inV ? "YES" : "NO ").padEnd(22)} ${(inH ? "YES" : "NO ").padEnd(22)} ${
        bestRank === 999 ? "-" : bestRank
      }`
    );
  }

  console.log(
    `\nPOOL RECALL@${POOL} (is the gold even a candidate?)\n` +
      `  vector: ${vecIn}/${rows.length} = ${(vecIn / rows.length).toFixed(3)}\n` +
      `  hybrid: ${hybIn}/${rows.length} = ${(hybIn / rows.length).toFixed(3)}\n\n` +
      `If pool recall is ~1.0 while recall@5 is 0.80, the RERANKER is the bottleneck and\n` +
      `changing the retriever cannot fix it.`
  );
  await db().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
