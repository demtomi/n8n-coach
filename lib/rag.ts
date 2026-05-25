import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

let _supabase: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _supabase;
}

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
  const { data, error } = await supabase().rpc("coach_match_documents", {
    query_embedding: embedding,
    match_count: RERANK_POOL_SIZE,
  });
  if (error) throw new Error(`rag retrieve failed: ${error.message}`);
  const pool = (data ?? []) as RagResult[];
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
