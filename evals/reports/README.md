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
