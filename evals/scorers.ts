import type { RagResult } from "@/lib/rag";
import Anthropic from "@anthropic-ai/sdk";

export type EvalQuery = {
  id: string;
  query: string;
  mode: "answer" | "debug" | "redirect";
  expected_doc_ids: string[];
  expected_facts: string[];
  tags?: string[];
};

export type RetrievalScore = {
  recall_at_5: number | null;
  mrr_at_5: number | null;
  top_doc_id: string | null;
  top_similarity: number | null;
};

export type ModeRoutingScore = {
  expected: EvalQuery["mode"];
  observed: EvalQuery["mode"];
  correct: boolean;
};

export type CitationValidityScore = {
  urls_found: number;
  urls_valid: number;
  validity_rate: number;
};

export function scoreRetrieval(q: EvalQuery, retrieved: RagResult[]): RetrievalScore {
  const top5 = retrieved.slice(0, 5);
  const ids = top5.map((r) => r.id);

  if (q.expected_doc_ids.length === 0) {
    return {
      recall_at_5: null,
      mrr_at_5: null,
      top_doc_id: ids[0] ?? null,
      top_similarity: top5[0]?.similarity ?? null,
    };
  }

  const hits = q.expected_doc_ids.filter((id) => ids.includes(id));
  const recall = hits.length / q.expected_doc_ids.length;

  let mrr = 0;
  for (const expectedId of q.expected_doc_ids) {
    const rank = ids.indexOf(expectedId);
    if (rank >= 0) {
      mrr += 1 / (rank + 1);
    }
  }
  mrr /= q.expected_doc_ids.length;

  return {
    recall_at_5: recall,
    mrr_at_5: mrr,
    top_doc_id: ids[0] ?? null,
    top_similarity: top5[0]?.similarity ?? null,
  };
}

export function scoreModeRouting(
  expected: EvalQuery["mode"],
  observed: EvalQuery["mode"]
): ModeRoutingScore {
  return { expected, observed, correct: expected === observed };
}

export function scoreCitationValidity(
  answer: string,
  corpus_urls: Set<string>
): CitationValidityScore {
  const urlRegex = /https?:\/\/[^\s)\]>]+/g;
  const found = Array.from(answer.matchAll(urlRegex)).map((m) => m[0].replace(/[).,;!?]+$/, ""));
  const docsUrls = found.filter((u) => u.includes("docs.n8n.io"));
  const valid = docsUrls.filter((u) => corpus_urls.has(u));
  return {
    urls_found: docsUrls.length,
    urls_valid: valid.length,
    validity_rate: docsUrls.length === 0 ? 1.0 : valid.length / docsUrls.length,
  };
}

export function scoreFaithfulnessStub(
  answer: string,
  expected_facts: string[]
): { covered: number; total: number; rate: number; missing: string[] } {
  if (expected_facts.length === 0) {
    return { covered: 0, total: 0, rate: 1.0, missing: [] };
  }
  const a = answer.toLowerCase();
  const covered: string[] = [];
  const missing: string[] = [];
  for (const fact of expected_facts) {
    const keywords = fact
      .toLowerCase()
      .split(/[\s,.;:()\-]+/)
      .filter((w) => w.length > 3 && !["with", "from", "this", "that", "into", "your", "node", "the", "and", "for", "via"].includes(w));
    if (keywords.length === 0) continue;
    const hits = keywords.filter((kw) => a.includes(kw)).length;
    if (hits / keywords.length >= 0.6) covered.push(fact);
    else missing.push(fact);
  }
  return {
    covered: covered.length,
    total: expected_facts.length,
    rate: covered.length / expected_facts.length,
    missing,
  };
}

// Verdict semantics:
//   supported    — fact is conveyed accurately and completely in the answer
//   partial      — fact is mentioned but incomplete, imprecise, or only implied
//   unsupported  — fact is not present in the answer
//   contradicted — answer states the opposite of the fact (actively wrong)
export type FactVerdict = "supported" | "partial" | "unsupported" | "contradicted";

export type FactJudgement = {
  fact: string;
  verdict: FactVerdict;
  passes: FactVerdict[];
  rationale: string;
};

export type FaithfulnessLLMScore = {
  judgements: FactJudgement[];
  supported: number;
  partial: number;
  unsupported: number;
  contradicted: number;
  total: number;
  rate: number;
};

const JUDGE_MODEL = "claude-haiku-4-5-20251001";
const JUDGE_PASSES = 3;

const VERDICT_RUBRIC = `<rubric>
Verdicts:
- supported: the answer conveys the fact accurately and substantively. Paraphrasing is fine; the meaning must match.
- partial: the answer mentions part of the fact, hints at it, or conveys it inaccurately but in the right direction.
- unsupported: the answer does not address this fact at all.
- contradicted: the answer states something that directly conflicts with the fact (wrong value, wrong behavior, inverted condition).
</rubric>`;

const VERDICT_INSTRUCTIONS = `You are judging whether a candidate answer conveys a specific expected fact about n8n. Be strict but fair: paraphrasing counts as supported; vague allusion is partial; omission is unsupported; an opposite or inverted claim is contradicted.

Return exactly one JSON object on one line, no prose, no markdown fence:
{"verdict":"supported|partial|unsupported|contradicted","rationale":"one short sentence"}`;

function lazyAnthropic(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

function majorityVerdict(passes: FactVerdict[]): FactVerdict {
  const counts: Record<FactVerdict, number> = {
    supported: 0,
    partial: 0,
    unsupported: 0,
    contradicted: 0,
  };
  for (const p of passes) counts[p]++;
  // Conservative tie-break order: contradicted > unsupported > partial > supported.
  // A single contradiction beats a single support on a tied vote — the gate is on
  // groundedness, not optimism.
  const priority: FactVerdict[] = ["contradicted", "unsupported", "partial", "supported"];
  let best: FactVerdict = "unsupported";
  let bestCount = -1;
  for (const v of priority) {
    if (counts[v] > bestCount) {
      best = v;
      bestCount = counts[v];
    }
  }
  return best;
}

function verdictWeight(v: FactVerdict): number {
  switch (v) {
    case "supported":
      return 1.0;
    case "partial":
      return 0.5;
    case "unsupported":
      return 0.0;
    case "contradicted":
      return -0.5;
  }
}

function parseVerdict(raw: string): { verdict: FactVerdict; rationale: string } {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return { verdict: "unsupported", rationale: `parse_failed: ${raw.slice(0, 80)}` };
  }
  try {
    const parsed = JSON.parse(match[0]) as { verdict?: string; rationale?: string };
    const v = (parsed.verdict || "").toLowerCase();
    if (v === "supported" || v === "partial" || v === "unsupported" || v === "contradicted") {
      return { verdict: v as FactVerdict, rationale: parsed.rationale ?? "" };
    }
    return { verdict: "unsupported", rationale: `unknown_verdict: ${v}` };
  } catch {
    return { verdict: "unsupported", rationale: `parse_failed: ${raw.slice(0, 80)}` };
  }
}

async function judgeOnePass(args: {
  client: Anthropic;
  query: string;
  answer: string;
  fact: string;
}): Promise<{ verdict: FactVerdict; rationale: string }> {
  const { client, query, answer, fact } = args;
  const userPrompt = `Question asked of the n8n coach:
${query}

Candidate answer:
${answer}

Expected fact to evaluate:
${fact}

${VERDICT_RUBRIC}
${VERDICT_INSTRUCTIONS}`;

  const result = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 200,
    temperature: 0,
    messages: [{ role: "user", content: userPrompt }],
  });
  const textBlock = result.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  return parseVerdict(raw);
}

export async function scoreFaithfulnessLLM(args: {
  query: string;
  answer: string;
  expected_facts: string[];
}): Promise<FaithfulnessLLMScore> {
  const { query, answer, expected_facts } = args;
  if (expected_facts.length === 0) {
    return {
      judgements: [],
      supported: 0,
      partial: 0,
      unsupported: 0,
      contradicted: 0,
      total: 0,
      rate: 1.0,
    };
  }

  const client = lazyAnthropic();
  const judgements: FactJudgement[] = [];

  for (const fact of expected_facts) {
    const passes: FactVerdict[] = [];
    let lastRationale = "";
    for (let i = 0; i < JUDGE_PASSES; i++) {
      const { verdict, rationale } = await judgeOnePass({ client, query, answer, fact });
      passes.push(verdict);
      if (rationale) lastRationale = rationale;
    }
    const verdict = majorityVerdict(passes);
    judgements.push({ fact, verdict, passes, rationale: lastRationale });
  }

  const counts: Record<FactVerdict, number> = {
    supported: 0,
    partial: 0,
    unsupported: 0,
    contradicted: 0,
  };
  for (const j of judgements) counts[j.verdict]++;

  const weighted = judgements.reduce((sum, j) => sum + verdictWeight(j.verdict), 0);
  const rate = Math.max(0, Math.min(1, weighted / judgements.length));

  return {
    judgements,
    supported: counts.supported,
    partial: counts.partial,
    unsupported: counts.unsupported,
    contradicted: counts.contradicted,
    total: judgements.length,
    rate,
  };
}
