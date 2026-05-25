# n8n Coach — Eval Report

Started: 2026-05-25T20:08:33.253Z
Finished: 2026-05-25T20:21:28.699Z
Queries: 30
Generation enabled: true

## Summary scores

| Metric | Value |
| --- | --- |
| Mode-routing accuracy | 0.933 |
| Mean recall@5 | 0.778 |
| Mean MRR@5 | 0.657 |
| Mean faithfulness (LLM-judge, 3-pass) | 0.745 |
| Mean citation validity | 0.785 |

## Faithfulness verdict distribution

| Verdict | Count | Share |
| --- | --- | --- |
| supported | 61 | 0.642 |
| partial | 17 | 0.179 |
| unsupported | 17 | 0.179 |
| contradicted | 0 | 0.000 |
| total facts judged | 95 | — |

## Per-query results

| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (s/p/u/c) | Rate | Citations | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ans-01-merge-modes | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 3/3 | 38535ms |
| ans-02-http-auth | answer/answer ✓ | 1.000 | 1.000 | 2/1/1/0 | 0.625 | 3/4 | 28874ms |
| ans-03-loop-batch | answer/answer ✓ | 1.000 | 1.000 | 4/0/0/0 | 1.000 | 1/1 | 29430ms |
| ans-04-if-vs-switch | answer/answer ✓ | 1.000 | 0.750 | 4/0/0/0 | 1.000 | 3/3 | 28791ms |
| ans-05-expression-now | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 2/2 | 38531ms |
| ans-06-webhook-response | answer/answer ✓ | 1.000 | 0.750 | 3/1/0/0 | 0.875 | 2/3 | 29815ms |
| ans-07-schedule-cron | answer/answer ✓ | 1.000 | 1.000 | 4/0/0/0 | 1.000 | 2/3 | 29880ms |
| ans-08-aggregate-vs-items | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 1/1 | 28305ms |
| ans-09-error-workflow | answer/answer ✓ | 1.000 | 1.000 | 3/1/0/0 | 0.875 | 5/5 | 31261ms |
| ans-10-code-run-once | answer/answer ✓ | 0.000 | 0.000 | 0/2/2/0 | 0.250 | 3/3 | 28179ms |
| ans-11-pipedrive-paginate | answer/answer ✓ | 1.000 | 0.333 | 3/0/1/0 | 0.750 | 3/3 | 34225ms |
| ans-12-subworkflow-data | answer/answer ✓ | — | — | 3/1/0/0 | 0.875 | 3/3 | 33733ms |
| ans-13-credentials-encryption | answer/answer ✓ | — | — | 0/0/4/0 | 0.000 | 4/5 | 25090ms |
| ans-14-set-vs-edit-fields | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 1/1 | 27475ms |
| ans-15-continue-on-fail | answer/answer ✓ | — | — | 1/2/1/0 | 0.500 | 0/1 | 26765ms |
| ans-16-langchain-agent-memory | answer/answer ✓ | 0.000 | 0.000 | 2/2/0/0 | 0.750 | 6/6 | 32968ms |
| ans-17-google-sheets-update | answer/answer ✓ | — | — | 0/4/0/0 | 0.500 | 1/3 | 32871ms |
| ans-18-binary-data | answer/answer ✓ | — | — | 2/1/1/0 | 0.625 | 2/3 | 37410ms |
| ans-19-self-host-queue-mode | answer/answer ✓ | — | — | 0/1/3/0 | 0.125 | 3/4 | 31941ms |
| ans-20-filter-empty | answer/answer ✓ | 1.000 | 1.000 | 2/1/1/0 | 0.625 | 1/1 | 32931ms |
| dbg-01-merge-no-output | debug/debug ✓ | 0.000 | 0.000 | 3/0/0/0 | 1.000 | 0/1 | 26826ms |
| dbg-02-loop-infinite | debug/debug ✓ | 0.000 | 0.000 | 3/0/0/0 | 1.000 | 3/3 | 31962ms |
| dbg-03-webhook-no-response | debug/debug ✓ | 1.000 | 0.750 | 3/0/0/0 | 1.000 | 1/2 | 26624ms |
| dbg-04-if-misroute | debug/debug ✓ | 1.000 | 1.000 | 3/0/0/0 | 1.000 | 2/2 | 28263ms |
| dbg-05-code-syntax | debug/debug ✓ | 1.000 | 0.250 | 3/0/0/0 | 1.000 | 1/2 | 27586ms |
| rdr-01-weather | redirect/redirect ✓ | — | — | — | — | — | 1392ms |
| rdr-02-forex | redirect/redirect ✓ | — | — | — | — | — | 1172ms |
| rdr-03-generic-python | redirect/answer ✗ | — | — | — | — | — | 1284ms |
| rdr-04-zapier-compare | redirect/answer ✗ | — | — | — | — | — | 1437ms |
| rdr-05-recipe | redirect/redirect ✓ | — | — | — | — | — | 1885ms |

## Notes

- Faithfulness is the LLM-judge (Haiku 4.5, 3-pass consensus, conservative tie-break). Per-fact verdicts persisted in the JSON sibling. Weighting: supported=1.0, partial=0.5, unsupported=0.0, contradicted=−0.5 (clamped to [0,1]).
- Recall@5 is null for queries with empty expected_doc_ids — labeling is loose for those.
- Latency includes network + Supabase RPC + (optional) generation + 3-pass judge.