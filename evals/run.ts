/**
 * Phase B4 eval harness — baseline runner.
 *
 * Usage:
 *   npm run eval               # full run (retrieval + answer generation + scoring), writes Markdown + JSON report
 *   npm run eval -- --no-gen   # skip Claude generation (retrieval + mode-routing only — fast and free)
 *   npm run eval -- --ids=ans-01,ans-02  # filter to specific query IDs
 *
 * Outputs:
 *   evals/reports/<timestamp>-baseline.md
 *   evals/reports/<timestamp>-baseline.json
 *
 * Reads `data/corpus.json` for citation URL validation. Hits the live retrieve()
 * RPC + Anthropic API. Cost on a full run ≈ $0.30 at Sonnet 4.6 pricing.
 *
 * Not in CI — run by hand as a baseline-before / baseline-after for B1 (rerank)
 * and B3 (hybrid search). Commit the resulting report file to git.
 */
import { config as loadEnv } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
import { retrieve } from "../lib/rag";
import { detectWorkflow } from "../lib/debug-mode";
import {
  scoreRetrieval,
  scoreModeRouting,
  scoreCitationValidity,
  scoreFaithfulnessStub,
  type EvalQuery,
} from "./scorers";

type CorpusEntry = { id: string; docs_url: string };

const OFF_TOPIC_SIM_THRESHOLD = 0.25;
const OFF_TOPIC_RELEVANCE_THRESHOLD = 0.3;

function parseArgs() {
  const args = process.argv.slice(2);
  const ids = args
    .find((a) => a.startsWith("--ids="))
    ?.slice("--ids=".length)
    .split(",");
  return {
    noGen: args.includes("--no-gen"),
    ids,
  };
}

async function classifyMode(query: string): Promise<"answer" | "debug" | "redirect"> {
  const wf = detectWorkflow(query);
  if (wf) return "debug";
  const remainder = wf ? "" : query;
  const retrieved = await retrieve(remainder, 1);
  const topSim = retrieved[0]?.similarity ?? 0;
  const topRel = retrieved[0]?.relevance_score ?? 0;
  return topSim >= OFF_TOPIC_SIM_THRESHOLD && topRel >= OFF_TOPIC_RELEVANCE_THRESHOLD
    ? "answer"
    : "redirect";
}

async function generateAnswer(query: string): Promise<string> {
  const wf = detectWorkflow(query);
  const semantic = wf ? wf.remainder || "debug this n8n workflow" : query;
  const retrieved = await retrieve(semantic, 5);

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const docsBlock = retrieved
    .map((r, i) => `<source index="${i + 1}" title="${r.title}" url="${r.docs_url}">\n${r.content}\n</source>`)
    .join("\n\n");

  const system = `You are an n8n workflow coach. Answer using ONLY the retrieved docs below. Cite docs.n8n.io URLs inline as markdown links. No preamble.\n\n<retrieved_docs>\n${docsBlock}\n</retrieved_docs>`;

  const result = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    temperature: 0.3,
    system,
    messages: [{ role: "user", content: query }],
  });

  const textBlock = result.content.find((b) => b.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text : "";
}

async function main() {
  const { noGen, ids } = parseArgs();

  const queriesPath = path.join(process.cwd(), "evals/queries.json");
  const corpusPath = path.join(process.cwd(), "data/corpus.json");
  const reportsDir = path.join(process.cwd(), "evals/reports");

  const data = JSON.parse(await fs.readFile(queriesPath, "utf8")) as {
    version: string;
    queries: EvalQuery[];
  };
  const corpus = JSON.parse(await fs.readFile(corpusPath, "utf8")) as CorpusEntry[];
  const corpusUrls = new Set(corpus.map((c) => c.docs_url));

  let queries = data.queries;
  if (ids?.length) queries = queries.filter((q) => ids.includes(q.id));

  const startedAt = new Date().toISOString();
  console.log(`[eval] running ${queries.length} queries (gen=${!noGen})`);

  const results: Array<Record<string, unknown>> = [];

  for (const q of queries) {
    const t0 = Date.now();
    const semantic = detectWorkflow(q.query)?.remainder || q.query;
    const observedMode = await classifyMode(q.query);
    const modeScore = scoreModeRouting(q.mode, observedMode);

    let retrievalScore = null as null | ReturnType<typeof scoreRetrieval>;
    let faithfulness = null as null | ReturnType<typeof scoreFaithfulnessStub>;
    let citation = null as null | ReturnType<typeof scoreCitationValidity>;
    let answer: string | null = null;

    if (q.mode !== "redirect") {
      const retrieved = await retrieve(semantic, 5);
      retrievalScore = scoreRetrieval(q, retrieved);
      if (!noGen) {
        answer = await generateAnswer(q.query);
        faithfulness = scoreFaithfulnessStub(answer, q.expected_facts);
        citation = scoreCitationValidity(answer, corpusUrls);
      }
    }

    const took = Date.now() - t0;
    console.log(
      `[eval] ${q.id} mode=${observedMode}${modeScore.correct ? "✓" : "✗"} recall@5=${retrievalScore?.recall_at_5?.toFixed(2) ?? "-"} faithful=${faithfulness?.rate.toFixed(2) ?? "-"} ${took}ms`
    );

    results.push({
      id: q.id,
      query: q.query.slice(0, 100),
      mode: modeScore,
      retrieval: retrievalScore,
      faithfulness,
      citation,
      answer: noGen ? null : answer,
      latency_ms: took,
    });
  }

  const summary = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    n: queries.length,
    gen_enabled: !noGen,
    mode_accuracy:
      results.filter((r) => (r.mode as { correct: boolean }).correct).length / queries.length,
    mean_recall_at_5: meanNonNull(results.map((r) => (r.retrieval as { recall_at_5: number | null } | null)?.recall_at_5 ?? null)),
    mean_mrr_at_5: meanNonNull(results.map((r) => (r.retrieval as { mrr_at_5: number | null } | null)?.mrr_at_5 ?? null)),
    mean_faithfulness_stub: meanNonNull(results.map((r) => (r.faithfulness as { rate: number } | null)?.rate ?? null)),
    mean_citation_validity: meanNonNull(results.map((r) => (r.citation as { validity_rate: number } | null)?.validity_rate ?? null)),
  };

  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const jsonPath = path.join(reportsDir, `${stamp}-baseline.json`);
  const mdPath = path.join(reportsDir, `${stamp}-baseline.md`);

  await fs.writeFile(jsonPath, JSON.stringify({ summary, results }, null, 2));
  await fs.writeFile(mdPath, renderMarkdown(summary, results));

  console.log("");
  console.log("=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));
  console.log("");
  console.log(`[eval] wrote ${mdPath}`);
  console.log(`[eval] wrote ${jsonPath}`);
}

function meanNonNull(xs: Array<number | null>): number | null {
  const vals = xs.filter((x): x is number => x !== null);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function renderMarkdown(
  summary: Record<string, unknown>,
  results: Array<Record<string, unknown>>
): string {
  const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3));
  const lines: string[] = [];
  lines.push(`# n8n Coach — Eval Report`);
  lines.push("");
  lines.push(`Started: ${summary.started_at}`);
  lines.push(`Finished: ${summary.finished_at}`);
  lines.push(`Queries: ${summary.n}`);
  lines.push(`Generation enabled: ${summary.gen_enabled}`);
  lines.push("");
  lines.push(`## Summary scores`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Mode-routing accuracy | ${fmt(summary.mode_accuracy as number)} |`);
  lines.push(`| Mean recall@5 | ${fmt(summary.mean_recall_at_5 as number | null)} |`);
  lines.push(`| Mean MRR@5 | ${fmt(summary.mean_mrr_at_5 as number | null)} |`);
  lines.push(`| Mean faithfulness (stub) | ${fmt(summary.mean_faithfulness_stub as number | null)} |`);
  lines.push(`| Mean citation validity | ${fmt(summary.mean_citation_validity as number | null)} |`);
  lines.push("");
  lines.push(`## Per-query results`);
  lines.push("");
  lines.push(`| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (stub) | Citations | Latency |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of results) {
    const mode = r.mode as { expected: string; observed: string; correct: boolean };
    const ret = r.retrieval as { recall_at_5: number | null; mrr_at_5: number | null } | null;
    const fr = r.faithfulness as { rate: number; covered: number; total: number } | null;
    const ct = r.citation as { urls_found: number; urls_valid: number } | null;
    lines.push(
      `| ${r.id} | ${mode.expected}/${mode.observed} ${mode.correct ? "✓" : "✗"} | ${fmt(ret?.recall_at_5)} | ${fmt(ret?.mrr_at_5)} | ${fr ? `${fr.covered}/${fr.total}` : "—"} | ${ct ? `${ct.urls_valid}/${ct.urls_found}` : "—"} | ${r.latency_ms}ms |`
    );
  }
  lines.push("");
  lines.push(`## Notes`);
  lines.push("");
  lines.push("- Faithfulness is the STUB scorer (keyword-overlap heuristic). LLM-judge replacement is open work in plan.md.");
  lines.push("- Recall@5 is null for queries with empty expected_doc_ids — labeling is loose for those.");
  lines.push("- Latency includes network + Supabase RPC + (optional) generation.");
  return lines.join("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
