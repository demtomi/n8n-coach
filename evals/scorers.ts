import type { RagResult } from "@/lib/rag";

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
