import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!VOYAGE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing VOYAGE_API_KEY, SUPABASE_URL, or SUPABASE_SERVICE_ROLE_KEY");
}

const CORPUS = path.resolve("data/corpus.json");
const BATCH = 32; // paid-tier safe

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function embedWithRetry(inputs: string[], attempt = 1): Promise<number[][]> {
  try {
    return await embedBatch(inputs);
  } catch (err) {
    const msg = String(err);
    if (attempt <= 3 && msg.includes("429")) {
      const waitMs = 30_000 * attempt;
      console.log(`  rate-limited, waiting ${waitMs / 1000}s (attempt ${attempt})`);
      await sleep(waitMs);
      return embedWithRetry(inputs, attempt + 1);
    }
    throw err;
  }
}

type Entry = {
  id: string;
  title: string;
  category: string;
  repo_path: string;
  docs_url: string;
  github_url: string;
  content: string;
};

async function embedBatch(inputs: string[]): Promise<number[][]> {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input: inputs, model: "voyage-3", input_type: "document" }),
  });
  if (!res.ok) throw new Error(`voyage ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
    usage: { total_tokens: number };
  };
  const sorted = [...json.data].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function main() {
  const entries: Entry[] = JSON.parse(fs.readFileSync(CORPUS, "utf8"));
  console.log(`loaded ${entries.length} entries from corpus`);

  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  // Resumability: skip IDs already embedded
  const { data: existing } = await supabase
    .from("coach_documents")
    .select("id")
    .not("embedding", "is", null);
  const done = new Set((existing ?? []).map((r) => r.id));
  const todo = entries.filter((e) => !done.has(e.id));
  console.log(`${done.size} already embedded, ${todo.length} to go`);

  let embedded = 0;
  let tokens = 0;
  const t0 = Date.now();

  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const vectors = await embedWithRetry(batch.map((e) => e.content));
    const rows = batch.map((e, j) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      repo_path: e.repo_path,
      docs_url: e.docs_url,
      github_url: e.github_url,
      content: e.content,
      embedding: vectors[j],
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase.from("coach_documents").upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`supabase upsert failed: ${error.message}`);

    embedded += batch.length;
    const batchChars = batch.reduce((a, e) => a + e.content.length, 0);
    tokens += Math.round(batchChars / 4);
    console.log(`  ${embedded}/${todo.length} (~${tokens} tokens, ${Math.round((Date.now() - t0) / 1000)}s)`);
  }

  console.log(`\n✓ embedded ${embedded} entries in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log(`  estimated cost: $${((tokens / 1_000_000) * 0.12).toFixed(4)} (voyage-3 @ $0.12/M)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
