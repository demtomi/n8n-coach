import { db, num } from "./db";
import { rerank } from "./rerank";

export type RagResult = {
  id: string;
  title: string;
  category: string;
  docs_url: string;
  github_url: string;
  content: string;
  similarity: number;
  relevance_score?: number;
};

const RERANK_POOL_SIZE = 50;

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-4",
      input_type: "query",
    }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };
  return json.data[0].embedding;
}

export async function retrieve(query: string, topK = 5): Promise<RagResult[]> {
  const embedding = await embedQuery(query);

  // JSON.stringify of a number[] is already a valid pgvector literal: [0.1,0.2,...]
  // The row generic is load-bearing: without it a column rename in a future migration
  // would silently yield undefined citations instead of a compile error.
  const pool = await db()<RagResult[]>`
    select id, title, category, docs_url, github_url, content, similarity
    from coach_match_documents(${JSON.stringify(embedding)}::vector, ${num(RERANK_POOL_SIZE)}::int)
  `;

  if (pool.length === 0) return [];

  const docs = pool.map((p) => `${p.title}\n\n${p.content}`);
  // Rerank the WHOLE pool, then take topK DISTINCT PAGES from the ranking.
  //
  // Chunking (D2) let one page occupy several of the five slots: a debug query spent two of
  // them on chunks 1 and 2 of the same "common issues" page. Every duplicate is a slot no
  // other page got, and the duplicated text is context we pay Anthropic for twice.
  //
  // Measured honestly: this does NOT improve recall@5 (0.8000 either way) — the rows that
  // miss, miss for other reasons. It buys a small MRR gain and a real prompt-size saving.
  // Do not sell it as a retrieval fix.
  const reranked = await rerank(query, docs, pool.length);

  const seen = new Set<string>();
  const out: RagResult[] = [];
  for (const r of reranked) {
    const doc = pool[r.index];
    const page = doc.id.replace(/__c\d{2,}$/, "");
    if (seen.has(page)) continue;
    seen.add(page);
    out.push({ ...doc, relevance_score: r.relevance_score });
    if (out.length === topK) break;
  }
  return out;
}

/**
 * The model is shown the index and the title. It is NOT shown `docs_url`, on purpose.
 *
 * It cites `[src:N]` and `lib/citations.ts` resolves N to the real URL server-side, so the
 * model has no use for the URL — and handing it one would leave the "it cannot invent a
 * link" property resting on an instruction rather than on the absence of the material.
 * A model that can read a URL can transcribe it onto the wrong claim, and a transcribed
 * URL is in the allow-list, so the resolver would wave it through. Withholding it is what
 * makes index-citation the only channel that exists.
 */
export function formatContext(results: RagResult[]): string {
  return results
    .map(
      (r, i) =>
        `<source index="${i + 1}" title="${r.title}">\n${r.content}\n</source>`
    )
    .join("\n\n");
}
