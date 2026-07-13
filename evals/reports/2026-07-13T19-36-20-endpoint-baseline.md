# n8n Coach — Eval Report

**Measured over HTTP against the deployed endpoint.**

| | |
| --- | --- |
| Endpoint | `https://coach.tamasdemeter.com/api/chat` |
| Build | `0adb25f` |
| Started | 2026-07-13T19:36:20.585Z |
| Finished | 2026-07-13T19:48:30.806Z |
| Queries | 30 |
| LLM judge | true |

## Summary scores

| Metric | Value |
| --- | --- |
| Mode-routing accuracy | 0.933 |
| Off-topic refusal rate | 0.600 |
| Mean recall@5 | 0.778 |
| Mean MRR@5 | 0.657 |
| Mean faithfulness (LLM-judge, 3-pass) | 0.828 |
| Citation validity (per LINK, not per query) | 0.818 |
| Citation links (valid / found) | 36 / 44 |

## Faithfulness verdict distribution

| Verdict | Count | Share |
| --- | --- | --- |
| supported | 73 | 0.768 |
| partial | 12 | 0.126 |
| unsupported | 9 | 0.095 |
| contradicted | 1 | 0.011 |
| total facts judged | 95 | — |

## Per-query results

| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (s/p/u/c) | Rate | Citations | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ans-01-merge-modes | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 1/1 | 17641ms |
| ans-02-http-auth | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 0/1 | 10662ms |
| ans-03-loop-batch | answer/answer ✓ | 1.000 | 1.000 | 3/1/0/0 | 0.875 | 1/1 | 10060ms |
| ans-04-if-vs-switch | answer/answer ✓ | 1.000 | 0.750 | 4/0/0/0 | 1.000 | 2/2 | 11338ms |
| ans-05-expression-now | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 1/1 | 9617ms |
| ans-06-webhook-response | answer/answer ✓ | 1.000 | 0.750 | 4/0/0/0 | 1.000 | 2/2 | 12833ms |
| ans-07-schedule-cron | answer/answer ✓ | 1.000 | 1.000 | 4/0/0/0 | 1.000 | 1/1 | 10270ms |
| ans-08-aggregate-vs-items | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 1/1 | 10336ms |
| ans-09-error-workflow | answer/answer ✓ | 1.000 | 1.000 | 3/1/0/0 | 0.875 | 2/2 | 12125ms |
| ans-10-code-run-once | answer/answer ✓ | 0.000 | 0.000 | 2/0/2/0 | 0.500 | 1/1 | 10087ms |
| ans-11-pipedrive-paginate | answer/answer ✓ | 1.000 | 0.333 | 3/1/0/0 | 0.875 | 1/1 | 16926ms |
| ans-12-subworkflow-data | answer/answer ✓ | — | — | 3/0/0/1 | 0.625 | 3/3 | 15239ms |
| ans-13-credentials-encryption | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 0/1 | 9767ms |
| ans-14-set-vs-edit-fields | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 1/1 | 5566ms |
| ans-15-continue-on-fail | answer/answer ✓ | — | — | 1/2/1/0 | 0.500 | 1/1 | 7363ms |
| ans-16-langchain-agent-memory | answer/answer ✓ | 0.000 | 0.000 | 2/2/0/0 | 0.750 | 4/4 | 12949ms |
| ans-17-google-sheets-update | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 0/1 | 11387ms |
| ans-18-binary-data | answer/answer ✓ | — | — | 3/0/1/0 | 0.750 | 3/4 | 11877ms |
| ans-19-self-host-queue-mode | answer/answer ✓ | — | — | 3/1/0/0 | 0.875 | 4/4 | 15379ms |
| ans-20-filter-empty | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 2/2 | 14716ms |
| dbg-01-merge-no-output | debug/debug ✓ | 0.000 | 0.000 | 3/0/0/0 | 1.000 | 0/0 | 15909ms |
| dbg-02-loop-infinite | debug/debug ✓ | 0.000 | 0.000 | 1/2/0/0 | 0.667 | 0/0 | 22330ms |
| dbg-03-webhook-no-response | debug/debug ✓ | 1.000 | 0.750 | 3/0/0/0 | 1.000 | 2/5 | 15351ms |
| dbg-04-if-misroute | debug/debug ✓ | 1.000 | 1.000 | 2/1/0/0 | 0.833 | 2/2 | 14707ms |
| dbg-05-code-syntax | debug/debug ✓ | 1.000 | 0.250 | 2/1/0/0 | 0.833 | 1/2 | 11260ms |
| rdr-01-weather | redirect/redirect ✓ | — | — | — | — | — | 2989ms |
| rdr-02-forex | redirect/redirect ✓ | — | — | — | — | — | 3183ms |
| rdr-03-generic-python | redirect/answer ✗ | — | — | — | — | — | 9146ms |
| rdr-04-zapier-compare | redirect/answer ✗ | — | — | — | — | — | 4628ms |
| rdr-05-recipe | redirect/redirect ✓ | — | — | — | — | — | 3167ms |

## Notes

- Every row is a real HTTP request to the endpoint above. Mode and retrieved doc ids are the endpoint's own report (`X-Coach-Mode` / `X-Coach-Docs`), not a re-derivation by the harness.
- Latency is end-to-end wall clock: gate + Voyage embed + rerank + full Sonnet stream. It is not comparable to the pre-2026-07-13 reports, which timed a different code path.
- Faithfulness is the LLM-judge (Haiku 4.5, 3-pass consensus, conservative tie-break), scored on the answer the deployed app actually streamed — including refusals it should not have made. Weighting: supported=1.0, partial=0.5, unsupported=0.0, contradicted=−0.5 (clamped to [0,1]).
- Citation validity is scored per LINK (valid ÷ found), not as a mean of per-query rates. A per-query mean would score a refusal that cites nothing as a perfect 1.0, rewarding the app for failing to answer.
- Recall@5 is null for queries with empty `expected_doc_ids` and for redirect-labelled queries.