import { createClient } from "@supabase/supabase-js";

export type RagResult = {
  id: string;
  title: string;
  category: string;
  docs_url: string;
  github_url: string;
  content: string;
  similarity: number;
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function embedQuery(text: string): Promise<number[]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: [text],
      model: "voyage-3",
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
  const { data, error } = await supabase.rpc("coach_match_documents", {
    query_embedding: embedding,
    match_count: topK,
  });
  if (error) throw new Error(`rag retrieve failed: ${error.message}`);
  return (data ?? []) as RagResult[];
}

export function formatContext(results: RagResult[]): string {
  return results
    .map(
      (r, i) =>
        `<source index="${i + 1}" title="${r.title}" url="${r.docs_url}">\n${r.content}\n</source>`
    )
    .join("\n\n");
}
