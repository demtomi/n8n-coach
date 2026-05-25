/**
 * Voyage rerank wrapper.
 *
 * Two-stage retrieval: pgvector fetches a broad pool (top-50), reranker scores
 * each (query, document) pair and returns top-K refined matches. Per
 * reference/api-references/voyage-api.md, rerank-2.5 supports 32K query+doc
 * tokens and 1,000 docs/request — well above our needs (50 docs × ~2,500 chars).
 *
 * Response shape: data[] sorted desc by relevance_score, each entry holds
 * `index` (pointing into the request's documents array) + `relevance_score`.
 */

export type RerankResult = {
  index: number;
  relevance_score: number;
};

type VoyageRerankResponse = {
  object: "list";
  data: RerankResult[];
  model: string;
  usage: { total_tokens: number };
};

const RERANK_MODEL = "rerank-2.5";
const RERANK_URL = "https://api.voyageai.com/v1/rerank";

export async function rerank(
  query: string,
  documents: string[],
  topK = 5
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  const res = await fetch(RERANK_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      documents,
      model: RERANK_MODEL,
      top_k: Math.min(topK, documents.length),
      return_documents: false,
      truncation: true,
    }),
  });

  if (!res.ok) {
    throw new Error(`voyage rerank ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as VoyageRerankResponse;
  return json.data;
}
