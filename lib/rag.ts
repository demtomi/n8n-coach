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
  const reranked = await rerank(query, docs, topK);

  return reranked.map((r) => ({
    ...pool[r.index],
    relevance_score: r.relevance_score,
  }));
}

export function formatContext(results: RagResult[]): string {
  return results
    .map(
      (r, i) =>
        `<source index="${i + 1}" title="${r.title}" url="${r.docs_url}">\n${r.content}\n</source>`
    )
    .join("\n\n");
}
