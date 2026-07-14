# Eval reports

## Every report dated before 2026-07-13 measured a SHADOW APP.

`evals/run.ts` used to reimplement the application instead of calling it. It built its own
system prompt (no vocab primer, no debug system), ran its own copy of the mode classifier,
and capped output at 800 tokens where the app allows 2,500.

So these files:

- `2026-05-25-pre-b1-baseline.*`
- `2026-05-25-post-b1-baseline.*`
- `2026-05-25-post-b1-judge-baseline.*`

do not describe `coach.tamasdemeter.com`. What that cost us, measured against the first real
endpoint run (`2026-07-13T19-36-20-endpoint-baseline`, build `0adb25f`):

| Metric | Shadow said | The deployed app is | Verdict on the old number |
| --- | --- | --- | --- |
| Faithfulness (LLM-judge) | 0.745 | **0.828** | **Wrong, and it understated the app.** The shadow prompt had no vocab primer and an 800-token ceiling. |
| Contradictions | "zero across 95 facts" | 1 raw / **0 adjudicated** | **Was never a measurement of the app at all.** It happened to land on the same answer. |
| Citation validity | 0.785 | **0.818 (36/44 links)** | **Not comparable — a different estimator.** 0.785 was a mean of per-query rates, which scores 1.0 for an answer that cites nothing. Per LINK, the old run was 0.824. |
| Recall@5 / MRR@5 | 0.778 / 0.657 | 0.778 / 0.657 | **Accidentally right.** Retrieval is deterministic, and the gold set never exercises the one path where the shadow's query derivation diverged (a bare workflow paste with no prose — every debug query in the set has prose around its JSON). Do not read this as vindication: it held by luck, not by construction. |
| Mode-routing accuracy | 0.933 | 0.933 | Accidentally right, same reason. |

The lesson is not "the old numbers were all bad." It is that **nobody could tell which ones
were bad without running the real thing** — and the one that was most load-bearing (the zero-
contradiction safety claim) was the one measuring a prompt that was never deployed.

None of the pre-2026-07-13 numbers is fit for a portfolio claim, a proposal, or a case study,
and none is a baseline the new reports can be diffed against.

## Reports from 2026-07-13 onward

Every row is a real HTTP POST to `/api/chat`. The mode and the retrieved doc ids come from
the endpoint's own report (`X-Coach-Mode`, `X-Coach-Docs`), and each report is stamped with
the endpoint it hit and the commit that endpoint was running (`X-Coach-Build`). A report the
runner cannot attribute to a commit says so in its header row and must not be cited as
evidence for a specific change.

`2026-07-13T19-36-20-endpoint-baseline.*` is the first real baseline. Compare only against it.

`2026-07-13T19-50-11-ans12-relabel.*` is a single-query re-measurement, not a baseline. It
exists as the evidence for one adjudication: the full run's only contradiction was the judge
faulting the app for saying "Execute Sub-workflow" where the gold fact said "Execute
Workflow". n8n renamed that node; the app was right and cited the correct docs URL. The gold
label was fixed in `queries.json` and that row re-measures at 4 supported / 0 contradicted.

`2026-07-14T09-24-35-fix6b-index-citations.*` — build `f85d6ef`, the first run after the
model stopped writing URLs (it cites `[src:N]`; the server resolves the index to the
`docs_url` of a document retrieval actually put in front of it).

| Metric | Baseline `0adb25f` | `f85d6ef` | |
| --- | --- | --- | --- |
| Citation validity | 0.818 (36/44 links) | **1.000 (108/108)** | By construction — a link can only be a retrieved doc's URL now. |
| Contradictions | 1 raw / 0 adjudicated | **0 raw / 95 facts** | |
| Faithfulness (LLM-judge) | 0.828 | 0.803 | **Read the note below before treating this as a regression.** |
| Recall@5 / MRR@5 | 0.778 / 0.657 | 0.778 / 0.657 | Bit-identical. Retrieval was not touched. |
| Mode-routing | 0.933 | 0.933 | Same two contested labels. |

### The faithfulness drop is one row, and it is the app getting MORE honest

87% of the −0.025 is a single query, `ans-19-self-host-queue-mode`, which fell 0.88 → 0.00.
Strip that row and the two builds are within noise (0.842 → 0.837, i.e. −0.005 across 24
rows that flip a verdict either way).

What happened on that row is the point:

- The corpus contains **no hosting documentation at all**. `QUEUE_BULL_REDIS_HOST` — one of
  the row's four gold facts — appears in **zero** of the 332 documents. The row's own
  `expected_doc_ids` is `[]`, which is the gold set admitting no corpus document supports it.
- The **baseline answered it anyway**, confidently and correctly, from the model's parametric
  memory of n8n — Redis broker, main/worker split, horizontal scaling. The judge compares the
  answer against the gold FACTS, not against the retrieved context, so it scored that
  ungrounded answer 0.88.
- The **new build refuses**: "the retrieved docs mention queue mode in passing but don't
  contain a full explanation … I can't give you a complete, accurate answer from the
  available sources alone", and then reports only what the sources do say. That is precisely
  what `BASE_SYSTEM` instructs. The judge scored it **0.00**.

So this scorer, as built, **rewards ungrounded-but-correct generation and punishes honest
refusal** — the same defect as the old per-query citation mean that scored 1.0 for citing
nothing, pointing the other way. `mean_faithfulness` is a fact-recall metric wearing a
groundedness label, and it is only a groundedness metric where the corpus can actually
support the question.

Two things follow, and **neither is "relabel ans-19 so the number goes back up"**:

1. **The corpus gap is real** (no hosting docs) and is what Phase D2 exists for. The baseline
   was concealing it by hallucinating over it.
2. **`ans-19` cannot be scored on fact recall.** It is an out-of-corpus probe, so the correct
   thing to grade is whether the app declines to answer beyond its sources. Until it is
   re-specified, its 0.00 should be read as a PASS on grounding and its contribution to the
   faithfulness mean should be quoted with this caveat attached.

Also note the two runs are not perfectly like-for-like: the baseline's `ans-12` row still
carried the stale "Execute Workflow" oracle (adjudicated afterwards, see above). Re-scoring
that row the way it was adjudicated puts the baseline at 0.843, not 0.828.

### Citation link count jumped 44 → 108, and the denominator changed meaning

Citation validity is per LINK, so the denominator is not fixed across builds. The old model
wrote a link when it felt like it; the new one cites an index after each supported claim and
every index becomes a link, so the same answers now carry roughly 2.5× as many. 108/108 means
every one of them resolves to a document that was actually retrieved for that query. It does
NOT mean the app cites 2.5× better — it means citation is now mechanical rather than
discretionary. Compare the RATE across builds; do not compare the counts.
