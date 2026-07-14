/**
 * Eval harness — measures the DEPLOYED coach, over HTTP.
 *
 * This runner POSTs `/api/chat` and scores what comes back. It does NOT build a system
 * prompt, classify a mode, or call retrieve(). It used to do all three, and that is why
 * every number it ever printed described a shadow app: its private prompt had no vocab
 * primer and no debug system, its max_tokens was 800 against the app's 2,500, and its
 * semantic query for a bare workflow paste was the raw JSON where the app sends
 * "debug this n8n workflow". Those reports are not comparable to this one — see
 * `evals/reports/README.md`.
 *
 * The mode the endpoint routed to and the docs it retrieved are read from the response
 * headers it now emits (`X-Coach-Mode`, `X-Coach-Docs`), so the measurement is the app's
 * own account of what it did.
 *
 * Usage:
 *   npm run eval                              # hit prod (coach.tamasdemeter.com)
 *   COACH_EVAL_URL=http://localhost:3000 npm run eval
 *   npm run eval -- --no-judge                # skip the LLM-judge faithfulness pass
 *   npm run eval -- --ids=ans-01,dbg-01       # filter to specific query IDs
 *   EVAL_LABEL=post-fix6 npm run eval         # names the report file
 *
 * COST — every query now spends real money on the target's account, because it goes
 * through the real gate: a Voyage embed, a 50-doc Voyage rerank, and a Sonnet 4.6 call.
 * A 30-query run settles around 50-80c against the coach's DAILY CEILING (default 300c,
 * `COACH_DAILY_BUDGET_CENTS`), and the ceiling is GLOBAL — a run eats budget that real
 * visitors would otherwise have. There is no free "--no-gen" mode any more; the endpoint
 * generates, that is the point. It also burns the runner's IP allowance (100/day), so
 * three full runs a day is the practical ceiling.
 *
 * The run ABORTS rather than reporting partial results if the target refuses for a reason
 * that is not "you are going too fast": a report covering 22 of 30 queries, published as
 * if it covered 30, is the exact false-green this fix exists to remove.
 *
 * Outputs `evals/reports/<timestamp>-<label>.{md,json}` — each stamped with the endpoint
 * and the build SHA it measured.
 */
import { config as loadEnv } from "dotenv";
import { promises as fs } from "fs";
import path from "path";

loadEnv({ path: path.join(process.cwd(), ".env.local") });
import {
  scoreRetrieval,
  scoreModeRouting,
  scoreCitationValidity,
  scoreFaithfulnessLLM,
  type EvalQuery,
  type FaithfulnessLLMScore,
  type RetrievalScore,
  type CitationValidityScore,
  type ModeRoutingScore,
} from "./scorers";

type CorpusEntry = { id: string; docs_url: string };
type Mode = "answer" | "debug" | "redirect";

const DEFAULT_TARGET = "https://coach.tamasdemeter.com";

// The endpoint allows 10 requests/minute per IP. Pace request STARTS below that instead of
// earning a 429 and burning a minute waiting it out.
const MIN_REQUEST_INTERVAL_MS = 6_500;
const RATE_LIMIT_WAIT_MS = 65_000;
const MAX_RATE_RETRIES = 3;

/** A refusal we must not paper over. Aborts the run; no report is written. */
class FatalEvalError extends Error {}

type CoachResponse = {
  mode: Mode;
  docIds: string[];
  nodes: number;
  build: string;
  answer: string;
  latencyMs: number;
};

/**
 * Did the answer decline to go beyond its retrieved sources?
 *
 * This is the ONLY assertion the out-of-corpus probe makes, so it must not be satisfied by an
 * answer that happens to contain a hedge while still inventing the release notes. It looks for
 * an explicit statement that the SOURCES do not cover the question.
 */
function declinesBeyondSources(answer: string): boolean {
  const a = answer.toLowerCase();
  return (
    /(retrieved |the )?(documentation|docs|sources?|context)[^.]{0,40}(does ?n.t|do ?n.t|doesn't|don't|cannot|can't|no information|nothing)/.test(
      a
    ) ||
    /(i )?(can.t|cannot|won.t|will not)[^.]{0,60}(answer|invent|make up|fabricate)/.test(a) ||
    /not (covered|available|present|included) in (the )?(retrieved )?(documentation|docs|sources?)/.test(a)
  );
}

function parseArgs() {
  const args = process.argv.slice(2);

  // Reject what we do not understand. `--no-gen` used to mean "skip generation, run free";
  // it cannot mean that any more (the endpoint generates — that is the point), and silently
  // ignoring it would spend real money off a command the caller believed was free.
  const unknown = args.filter((a) => a !== "--no-judge" && !a.startsWith("--ids="));
  if (unknown.length) {
    throw new FatalEvalError(
      `unknown flag(s): ${unknown.join(" ")}. Supported: --no-judge, --ids=a,b. ` +
        `(--no-gen is GONE: every query now goes through the real endpoint, which always ` +
        `generates and always costs money. Point COACH_EVAL_URL at a local dev server if ` +
        `you want to keep the spend off production.)`
    );
  }

  const ids = args
    .find((a) => a.startsWith("--ids="))
    ?.slice("--ids=".length)
    .split(",");
  const target = (process.env.COACH_EVAL_URL ?? DEFAULT_TARGET).replace(/\/$/, "");
  return {
    noJudge: args.includes("--no-judge"),
    ids,
    target,
    targetIsLocal: /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(target),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseMode(raw: string | null): Mode {
  if (raw === "answer" || raw === "debug" || raw === "redirect") return raw;
  throw new FatalEvalError(
    `endpoint did not report a mode (X-Coach-Mode = ${JSON.stringify(raw)}). ` +
      `Is the target running a build that predates the eval fix?`
  );
}

/**
 * Drain the AI SDK UI-message stream into the answer text.
 *
 * Protocol drift is made LOUD: if the stream carried chunks but not one text delta, we
 * throw instead of returning "", which would otherwise score as a confident zero on
 * faithfulness and look like a model regression.
 */
async function readAnswer(res: Response): Promise<string> {
  if (!res.body) throw new FatalEvalError("response had no body");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let answer = "";
  let chunks = 0;
  let deltas = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;

      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;

        const payload = line.slice("data:".length).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: { type?: string; delta?: unknown; errorText?: string };
        try {
          chunk = JSON.parse(payload);
        } catch {
          continue;
        }
        chunks++;

        if (chunk.type === "error") {
          throw new FatalEvalError(
            `endpoint streamed an error chunk: ${chunk.errorText ?? payload.slice(0, 200)}`
          );
        }
        if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
          answer += chunk.delta;
          deltas++;
        }
      }
    }
  } finally {
    // Bailing out mid-stream leaves the body locked and undrained otherwise.
    await reader.cancel().catch(() => {});
  }

  if (chunks > 0 && deltas === 0) {
    throw new FatalEvalError(
      `stream carried ${chunks} chunks but no text-delta — the UI-message wire format has ` +
        `changed and this parser is reading the wrong field. Refusing to score an empty answer.`
    );
  }
  return answer;
}

async function askCoach(target: string, query: string, attempt = 0): Promise<CoachResponse> {
  const t0 = Date.now();
  const res = await fetch(`${target}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "eval-1", role: "user", parts: [{ type: "text", text: query }] }],
    }),
  });

  if (!res.ok) {
    const gate = res.headers.get("x-coach-gate");
    const body = await res.text();

    // The ONLY retryable refusal. Everything else means the measurement cannot be taken.
    if (res.status === 429 && gate === "rate_minute") {
      if (attempt >= MAX_RATE_RETRIES) {
        throw new FatalEvalError(`still rate-limited after ${MAX_RATE_RETRIES} retries`);
      }
      console.log(`[eval] rate-limited (minute bucket); waiting ${RATE_LIMIT_WAIT_MS / 1000}s`);
      await sleep(RATE_LIMIT_WAIT_MS);
      return askCoach(target, query, attempt + 1);
    }

    if (gate === "budget") {
      throw new FatalEvalError(
        `the coach hit its DAILY SPEND CEILING mid-run. Nothing measured after this point ` +
          `would be comparable. Raise COACH_DAILY_BUDGET_CENTS on the target (or wait for ` +
          `UTC midnight) and re-run from scratch. Body: ${body}`
      );
    }
    if (gate === "rate_day") {
      throw new FatalEvalError(
        `this IP is out of its 100/day allowance on the target. Re-run tomorrow. Body: ${body}`
      );
    }
    throw new FatalEvalError(`HTTP ${res.status}${gate ? ` (gate=${gate})` : ""}: ${body}`);
  }

  const mode = parseMode(res.headers.get("x-coach-mode"));
  const docIds = (res.headers.get("x-coach-docs") ?? "").split(",").filter(Boolean);
  const nodes = Number(res.headers.get("x-coach-nodes") ?? 0);
  const build = res.headers.get("x-coach-build") ?? "unknown";
  const answer = await readAnswer(res);

  if (!answer.trim()) {
    throw new FatalEvalError(
      `endpoint returned 200 with an empty answer (mode=${mode}). Scoring that as a zero ` +
        `would blame the model for a transport bug.`
    );
  }

  return { mode, docIds, nodes, build, answer, latencyMs: Date.now() - t0 };
}

type ResultRow = {
  id: string;
  query: string;
  http_mode: Mode;
  mode: ModeRoutingScore;
  retrieval: RetrievalScore | null;
  faithfulness: FaithfulnessLLMScore | null;
  citation: CitationValidityScore | null;
  refused: boolean | null;
  answer: string;
  nodes: number;
  build: string;
  latency_ms: number;
};

async function main() {
  const { noJudge, ids, target, targetIsLocal } = parseArgs();

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
  if (queries.length === 0) throw new FatalEvalError("no queries selected");

  const startedAt = new Date().toISOString();
  console.log(`[eval] target  ${target}/api/chat`);
  console.log(`[eval] running ${queries.length} queries (judge=${!noJudge})`);
  console.log(`[eval] this spends REAL budget on the target's daily ceiling`);

  const results: ResultRow[] = [];
  const builds = new Set<string>();

  for (const q of queries) {
    const t0 = Date.now();
    const r = await askCoach(target, q.query);
    builds.add(r.build);

    const modeScore = scoreModeRouting(q.mode, r.mode);

    // Retrieval always runs inside the endpoint, even on a redirect. Score it wherever the
    // query is labelled with expected docs; a query the app WRONGLY redirected still had
    // its docs retrieved, and hiding that would hide the failure.
    const retrieval = q.mode === "redirect" ? null : scoreRetrieval(q, r.docIds);

    // Faithfulness and citations are scored on the REAL answer the app produced. If the app
    // misrouted an answerable question to a refusal, that refusal is what gets judged — and
    // it scores near zero. That is correct: the deployed app failed to answer. The old
    // harness generated an answer regardless of routing, so a routing failure could never
    // show up in the faithfulness number.
    let faithfulness: FaithfulnessLLMScore | null = null;
    let citation: CitationValidityScore | null = null;
    if (q.mode !== "redirect") {
      citation = scoreCitationValidity(r.answer, corpusUrls);
      if (!noJudge) {
        faithfulness = await scoreFaithfulnessLLM({
          query: q.query,
          answer: r.answer,
          expected_facts: q.expected_facts,
        });
      }
    }

    const faithSummary = faithfulness
      ? `${faithfulness.supported}s/${faithfulness.partial}p/${faithfulness.unsupported}u/${faithfulness.contradicted}c (${faithfulness.rate?.toFixed(2) ?? "n/a — no facts, refusal probe"})`
      : "-";
    console.log(
      `[eval] ${q.id} mode=${r.mode}${modeScore.correct ? "✓" : "✗"} recall@5=${retrieval?.recall_at_5?.toFixed(2) ?? "-"} faithful=${faithSummary} cite=${citation ? `${citation.urls_valid}/${citation.urls_found}` : "-"} ${r.latencyMs}ms`
    );

    results.push({
      id: q.id,
      query: q.query.slice(0, 100),
      http_mode: r.mode,
      mode: modeScore,
      retrieval,
      faithfulness,
      citation,
      // A refusal is scored for the OFF-TOPIC rows (did the gate redirect?) and for the
      // OUT-OF-CORPUS probe (did the app decline to answer beyond its sources?). They test
      // two different properties; the probe is answer-mode by design — it is a legitimate
      // n8n question that the corpus simply cannot support, so routing it to `answer` is
      // correct and REFUSING INSIDE that answer is the thing being measured.
      refused:
        q.mode === "redirect"
          ? r.mode === "redirect"
          : q.out_of_corpus
            ? declinesBeyondSources(r.answer)
            : null,
      answer: r.answer,
      nodes: r.nodes,
      build: r.build,
      latency_ms: r.latencyMs,
    });

    // Stay under the endpoint's own per-IP minute limit.
    const spent = Date.now() - t0;
    if (spent < MIN_REQUEST_INTERVAL_MS) await sleep(MIN_REQUEST_INTERVAL_MS - spent);
  }

  if (builds.size > 1) {
    console.warn(
      `[eval] WARNING: the target changed build mid-run (${[...builds].join(", ")}). ` +
        `These rows do not describe one system.`
    );
  }

  // PROVENANCE. A number is only worth something if we can name the code it measured.
  const build = [...builds].join(",");
  if (!targetIsLocal && builds.has("local")) {
    throw new FatalEvalError(
      `the remote target reported build "local". A hosted instance cannot be a local build, ` +
        `so this report could not be attributed to any deploy. Refusing to write it.`
    );
  }
  const attributed = !builds.has("vercel-nogit") && !builds.has("unknown");
  if (!attributed) {
    console.warn(
      `[eval] WARNING: the target cannot name its own commit (build=${build}). This report ` +
        `measures the deployed endpoint but CANNOT say which commit that is — do not quote ` +
        `it as evidence for a specific change. Deploy with git metadata to fix.`
    );
  }

  const redirectRows = results.filter((r) => r.refused !== null);
  const urlsFound = results.reduce((n, r) => n + (r.citation?.urls_found ?? 0), 0);
  const urlsValid = results.reduce((n, r) => n + (r.citation?.urls_valid ?? 0), 0);

  const summary = {
    target: `${target}/api/chat`,
    build,
    build_attributed: attributed,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    n: queries.length,
    judge_enabled: !noJudge,
    mode_accuracy: results.filter((r) => r.mode.correct).length / queries.length,
    refusal_rate: redirectRows.length
      ? redirectRows.filter((r) => r.refused).length / redirectRows.length
      : null,
    mean_recall_at_5: meanNonNull(results.map((r) => r.retrieval?.recall_at_5 ?? null)),
    mean_mrr_at_5: meanNonNull(results.map((r) => r.retrieval?.mrr_at_5 ?? null)),
    mean_faithfulness_llm: meanNonNull(results.map((r) => r.faithfulness?.rate ?? null)),
    faithfulness_verdict_counts: aggregateVerdicts(results),
    // Citation validity is a LINK-level property, so it is scored over links, not averaged
    // over queries. A per-query mean scores 1.0 for an answer that cites nothing at all —
    // so an app that misroutes an answerable question to a one-line refusal gets REWARDED
    // in that mean. This denominator cannot be gamed by not citing.
    citation_validity: urlsFound ? urlsValid / urlsFound : null,
    citation_urls_found: urlsFound,
    citation_urls_valid: urlsValid,
  };

  await fs.mkdir(reportsDir, { recursive: true });
  const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const suffix = process.env.EVAL_LABEL ? `-${process.env.EVAL_LABEL}` : "-endpoint";
  const jsonPath = path.join(reportsDir, `${stamp}${suffix}.json`);
  const mdPath = path.join(reportsDir, `${stamp}${suffix}.md`);

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

function aggregateVerdicts(results: ResultRow[]): {
  supported: number;
  partial: number;
  unsupported: number;
  contradicted: number;
  total: number;
} {
  const acc = { supported: 0, partial: 0, unsupported: 0, contradicted: 0, total: 0 };
  for (const r of results) {
    const f = r.faithfulness;
    if (!f) continue;
    acc.supported += f.supported;
    acc.partial += f.partial;
    acc.unsupported += f.unsupported;
    acc.contradicted += f.contradicted;
    acc.total += f.total;
  }
  return acc;
}

function renderMarkdown(
  summary: Record<string, unknown>,
  results: ResultRow[]
): string {
  const fmt = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(3));
  const lines: string[] = [];
  lines.push(`# n8n Coach — Eval Report`);
  lines.push("");
  lines.push(`**Measured over HTTP against the deployed endpoint.**`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Endpoint | \`${summary.target}\` |`);
  lines.push(
    `| Build | \`${summary.build}\`${summary.build_attributed ? "" : " — **UNATTRIBUTED: the target could not name its own commit. Do not quote this report as evidence for a specific change.**"} |`
  );
  lines.push(`| Started | ${summary.started_at} |`);
  lines.push(`| Finished | ${summary.finished_at} |`);
  lines.push(`| Queries | ${summary.n} |`);
  lines.push(`| LLM judge | ${summary.judge_enabled} |`);
  lines.push("");
  lines.push(`## Summary scores`);
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Mode-routing accuracy | ${fmt(summary.mode_accuracy as number)} |`);
  lines.push(`| Off-topic refusal rate | ${fmt(summary.refusal_rate as number | null)} |`);
  lines.push(`| Mean recall@5 | ${fmt(summary.mean_recall_at_5 as number | null)} |`);
  lines.push(`| Mean MRR@5 | ${fmt(summary.mean_mrr_at_5 as number | null)} |`);
  lines.push(`| Mean faithfulness (LLM-judge, 3-pass) | ${fmt(summary.mean_faithfulness_llm as number | null)} |`);
  lines.push(`| Citation validity (per LINK, not per query) | ${fmt(summary.citation_validity as number | null)} |`);
  lines.push(`| Citation links (valid / found) | ${summary.citation_urls_valid} / ${summary.citation_urls_found} |`);
  lines.push("");
  const verdicts = summary.faithfulness_verdict_counts as {
    supported: number;
    partial: number;
    unsupported: number;
    contradicted: number;
    total: number;
  };
  if (verdicts.total > 0) {
    lines.push(`## Faithfulness verdict distribution`);
    lines.push("");
    lines.push(`| Verdict | Count | Share |`);
    lines.push(`| --- | --- | --- |`);
    lines.push(`| supported | ${verdicts.supported} | ${fmt(verdicts.supported / verdicts.total)} |`);
    lines.push(`| partial | ${verdicts.partial} | ${fmt(verdicts.partial / verdicts.total)} |`);
    lines.push(`| unsupported | ${verdicts.unsupported} | ${fmt(verdicts.unsupported / verdicts.total)} |`);
    lines.push(`| contradicted | ${verdicts.contradicted} | ${fmt(verdicts.contradicted / verdicts.total)} |`);
    lines.push(`| total facts judged | ${verdicts.total} | — |`);
    lines.push("");
  }
  lines.push(`## Per-query results`);
  lines.push("");
  lines.push(`| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (s/p/u/c) | Rate | Citations | Latency |`);
  lines.push(`| --- | --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of results) {
    const fr = r.faithfulness;
    const ct = r.citation;
    const faithCol = fr ? `${fr.supported}/${fr.partial}/${fr.unsupported}/${fr.contradicted}` : "—";
    lines.push(
      `| ${r.id} | ${r.mode.expected}/${r.mode.observed} ${r.mode.correct ? "✓" : "✗"} | ${fmt(r.retrieval?.recall_at_5)} | ${fmt(r.retrieval?.mrr_at_5)} | ${faithCol} | ${fmt(fr?.rate ?? null)} | ${ct ? `${ct.urls_valid}/${ct.urls_found}` : "—"} | ${r.latency_ms}ms |`
    );
  }
  lines.push("");
  lines.push(`## Notes`);
  lines.push("");
  lines.push("- Every row is a real HTTP request to the endpoint above. Mode and retrieved doc ids are the endpoint's own report (`X-Coach-Mode` / `X-Coach-Docs`), not a re-derivation by the harness.");
  lines.push("- Latency is end-to-end wall clock: gate + Voyage embed + rerank + full Sonnet stream. It is not comparable to the pre-2026-07-13 reports, which timed a different code path.");
  lines.push("- Faithfulness is the LLM-judge (Haiku 4.5, 3-pass consensus, conservative tie-break), scored on the answer the deployed app actually streamed — including refusals it should not have made. Weighting: supported=1.0, partial=0.5, unsupported=0.0, contradicted=−0.5 (clamped to [0,1]).");
  lines.push("- Citation validity is scored per LINK (valid ÷ found), not as a mean of per-query rates. A per-query mean would score a refusal that cites nothing as a perfect 1.0, rewarding the app for failing to answer.");
  lines.push("- Recall@5 is null for queries with empty `expected_doc_ids` and for redirect-labelled queries.");
  return lines.join("\n");
}

main().catch((e) => {
  if (e instanceof FatalEvalError) {
    console.error(`\n[eval] ABORTED — no report written.\n[eval] ${e.message}\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
