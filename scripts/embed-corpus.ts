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
    body: JSON.stringify({ input: inputs, model: "voyage-4", input_type: "document" }),
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
  const dry = process.argv.includes("--dry-run");
  // A dry run is DRY: --dry-run beats --prune, always. A "preview" that deletes 109 rows
  // because it was passed both flags is the worst possible way to learn the precedence.
  const prune = process.argv.includes("--prune") && !dry;

  // The table must end up equal to the corpus file. Three ways it can differ, and the old
  // "skip every id I already have" logic only handled the first:
  //
  //   1. NEW id            → embed it.
  //   2. SAME id, CHANGED content → must be RE-embedded. Skipping it leaves the DB serving
  //      April's text while corpus.json (and every check run against it) describes today's.
  //      A vector computed from text nobody can read any more is a silent lie.
  //   3. id GONE from the corpus → must be DELETED, or it stays retrievable forever. The
  //      2026-07 rebuild moved docs/workflows + docs/code to docs/build upstream: without a
  //      prune, both copies sit in the table competing for the same top-5 slots.
  //
  // Deletion is gated behind --prune and always prints what it will remove first. The
  // content is reproducible from corpus.json and the vectors cost cents to regenerate, so
  // this is recoverable — but it is still a destructive write to a shared production DB.
  const { data: existing, error: readErr } = await supabase
    .from("coach_documents")
    .select("id, content")
    .not("embedding", "is", null);
  if (readErr) throw new Error(`could not read existing rows: ${readErr.message}`);

  const have = new Map((existing ?? []).map((r) => [r.id as string, r.content as string]));
  const wanted = new Set(entries.map((e) => e.id));

  const todo = entries.filter((e) => have.get(e.id) !== e.content);
  const added = todo.filter((e) => !have.has(e.id)).length;
  const changed = todo.length - added;
  const stale = [...have.keys()].filter((id) => !wanted.has(id));

  console.log(
    `db has ${have.size} rows | corpus has ${entries.length}\n` +
      `  new:     ${added}\n` +
      `  changed: ${changed} (re-embedding — content drifted from the corpus)\n` +
      `  stale:   ${stale.length}${prune ? " (will be DELETED)" : " (left in place; pass --prune to delete)"}`
  );

  if (stale.length && prune) {
    console.log(`  deleting ${stale.length} stale rows, e.g. ${stale.slice(0, 3).join(", ")}`);
    for (let i = 0; i < stale.length; i += 100) {
      const { error } = await supabase
        .from("coach_documents")
        .delete()
        .in("id", stale.slice(i, i + 100));
      if (error) throw new Error(`prune failed: ${error.message}`);
    }
    console.log(`  ✓ pruned`);
  }

  // Reads, reports, spends nothing, writes nothing. (`prune` is already forced false above
  // under --dry-run, so no delete can have run before this point.)
  if (dry) {
    const chars = todo.reduce((a, e) => a + e.content.length, 0);
    console.log(
      `\nDRY RUN — nothing embedded, nothing written.\n` +
        `  would embed ${todo.length} rows, ~${Math.round(chars / 4).toLocaleString()} tokens`
    );
    return;
  }

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
  console.log(`  estimated cost: $${((tokens / 1_000_000) * 0.06).toFixed(4)} (voyage-4 @ $0.06/M)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
