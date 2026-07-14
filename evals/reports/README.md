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

## 2026-07-14 — the gold set was measuring 18 of 30 rows, and the corpus is 3 of ~12 doc sections

Audit of the gold set itself (no run, no spend). Two defects, one of them load-bearing.

### 1. `recall@5` was computed over a partial denominator

`mean_recall_at_5` uses `meanNonNull`, and `recall_at_5` is `null` for any row with an empty
`expected_doc_ids`. **Twelve of the 30 rows had none** — the 5 redirect rows (correct: they
have no gold) and **seven answer rows** (`ans-05`, `ans-12`, `ans-13`, `ans-15`, `ans-17`,
`ans-18`, `ans-19`). So the reported **0.778 was 14/18**, not a number about the 30-query set,
and the 0.85 Phase B exit gate was being judged on 60% of it. `ans-19` was documented as the
one unlabelled row. It was one of seven.

### 2. Only THREE of those seven are answerable. The other four have no doc to retrieve.

Checked against `data/corpus.json` directly, not against what the app returned:

| row | verdict | evidence in the corpus |
| --- | --- | --- |
| `ans-12` subworkflow | **labelled** | `executeworkflow` + `executeworkflowtrigger` both present |
| `ans-15` continue-on-fail | **labelled** | `workflows/components/nodes.md` documents Always Output Data + On Error → Continue |
| `ans-18` binary attachment | **labelled** | `sendemail.md`: "Attachments: enter the name of the binary properties…" |
| `ans-05` `$now` expression | **out-of-corpus** | `$now` and `toFormat` appear in **0 of 332 docs** (`docs/code/expressions` was never ingested) |
| `ans-13` credential encryption | **out-of-corpus** | `N8N_ENCRYPTION_KEY` appears in **0 docs** |
| `ans-17` Google Sheets update | **out-of-corpus** | the corpus contains **zero app-node docs** — there is no Sheets action-node page to retrieve |
| `ans-19` hosting / queue mode | **out-of-corpus** | no hosting/queue/worker/scaling/docker doc exists (the known 6c finding) |

**The corpus is `docs/integrations` (288) + `docs/workflows` (24) + `docs/code` (20). That is
all.** Missing wholesale: `docs/hosting`, `docs/credentials`, `docs/data` (binary data),
`docs/flow-logic`, `docs/code/expressions`, and **every app node** (Gmail, Sheets, Slack,
Notion…). The corpus has 107 trigger-node and 102 LangChain cluster-node pages and not one
Google Sheets page. "No hosting docs" badly understated the gap.

This also explains why `ans-05` scored **4/4 supported** on a question the corpus cannot
answer: `mean_faithfulness` grades whether the ANSWER states the gold facts, so an answer
generated from the model's parametric memory scores full marks while retrieval gave it
nothing. It is fact recall wearing a groundedness label — the defect already named under 6c,
now with a second confirmed instance.

### The recomputed number

Recall was **recomputed offline against the frozen `f85d6ef` report**, whose
`retrieved_doc_ids` are already recorded per row. No re-run, no API spend: fix 7 was
front-end only, so that report still describes the deployed retrieval.

| | rows scored | recall@5 | MRR@5 |
| --- | --- | --- | --- |
| as reported | 18 | 0.778 | 0.657 |
| **with the 3 new labels** | **21** | **0.8095** | **0.7421** |

**The 0.85 exit gate is still NOT met.** Read the +0.03 with its bias: the rows that COULD be
labelled are, by construction, rows where a correct doc exists — and all three turned out to
be rows retrieval already got right (1.00/1.00 each). The labels were picked from the corpus
by content, never from what the app retrieved; labelling gold as "whatever came back" would
guarantee 1.0 and turn the metric into a mirror.

Four rows still score **0.00 recall**, and their gold ids were verified to exist in the corpus
(all 30 gold ids resolve), so these are genuine retrieval misses and the real target for B3
(hybrid search): `ans-10-code-run-once`, `ans-16-langchain-agent-memory`, `dbg-01-merge-no-output`,
`dbg-02-loop-infinite`.

The four out-of-corpus rows are now flagged `out_of_corpus: true` in `queries.json` with the
reason. They must NOT be graded on fact recall, and they must NOT be relabelled to flatter the
faithfulness mean. Until D2 embeds the missing sections they are the only refusal probes the
suite has — and once D2 lands they stop being probes, so a permanent out-of-corpus probe
(pinned to something that will never enter the corpus) has to replace them.
