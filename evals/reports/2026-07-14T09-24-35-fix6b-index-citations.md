# n8n Coach — Eval Report

**Measured over HTTP against the deployed endpoint.**

| | |
| --- | --- |
| Endpoint | `https://coach.tamasdemeter.com/api/chat` |
| Build | `f85d6ef` |
| Started | 2026-07-14T09:24:35.106Z |
| Finished | 2026-07-14T09:38:58.053Z |
| Queries | 30 |
| LLM judge | true |

## Summary scores

| Metric | Value |
| --- | --- |
| Mode-routing accuracy | 0.933 |
| Off-topic refusal rate | 0.600 |
| Mean recall@5 | 0.778 |
| Mean MRR@5 | 0.657 |
| Mean faithfulness (LLM-judge, 3-pass) | 0.803 |
| Citation validity (per LINK, not per query) | 1.000 |
| Citation links (valid / found) | 108 / 108 |

## Faithfulness verdict distribution

| Verdict | Count | Share |
| --- | --- | --- |
| supported | 70 | 0.737 |
| partial | 11 | 0.116 |
| unsupported | 14 | 0.147 |
| contradicted | 0 | 0.000 |
| total facts judged | 95 | — |

## Per-query results

| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (s/p/u/c) | Rate | Citations | Latency |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ans-01-merge-modes | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 5/5 | 16257ms |
| ans-02-http-auth | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 4/4 | 9389ms |
| ans-03-loop-batch | answer/answer ✓ | 1.000 | 1.000 | 4/0/0/0 | 1.000 | 6/6 | 10135ms |
| ans-04-if-vs-switch | answer/answer ✓ | 1.000 | 0.750 | 4/0/0/0 | 1.000 | 7/7 | 10396ms |
| ans-05-expression-now | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 2/2 | 11447ms |
| ans-06-webhook-response | answer/answer ✓ | 1.000 | 0.750 | 3/1/0/0 | 0.875 | 6/6 | 12497ms |
| ans-07-schedule-cron | answer/answer ✓ | 1.000 | 1.000 | 4/0/0/0 | 1.000 | 6/6 | 8252ms |
| ans-08-aggregate-vs-items | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 3/3 | 9431ms |
| ans-09-error-workflow | answer/answer ✓ | 1.000 | 1.000 | 3/1/0/0 | 0.875 | 8/8 | 12791ms |
| ans-10-code-run-once | answer/answer ✓ | 0.000 | 0.000 | 2/1/1/0 | 0.625 | 3/3 | 11243ms |
| ans-11-pipedrive-paginate | answer/answer ✓ | 1.000 | 0.333 | 2/1/1/0 | 0.625 | 8/8 | 15551ms |
| ans-12-subworkflow-data | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 8/8 | 15095ms |
| ans-13-credentials-encryption | answer/answer ✓ | — | — | 2/1/1/0 | 0.625 | 4/4 | 14356ms |
| ans-14-set-vs-edit-fields | answer/answer ✓ | 1.000 | 1.000 | 3/0/1/0 | 0.750 | 2/2 | 6135ms |
| ans-15-continue-on-fail | answer/answer ✓ | — | — | 1/2/1/0 | 0.500 | 3/3 | 6235ms |
| ans-16-langchain-agent-memory | answer/answer ✓ | 0.000 | 0.000 | 3/1/0/0 | 0.875 | 5/5 | 15085ms |
| ans-17-google-sheets-update | answer/answer ✓ | — | — | 4/0/0/0 | 1.000 | 0/0 | 13548ms |
| ans-18-binary-data | answer/answer ✓ | — | — | 2/1/1/0 | 0.625 | 7/7 | 11567ms |
| ans-19-self-host-queue-mode | answer/answer ✓ | — | — | 0/0/4/0 | 0.000 | 3/3 | 10195ms |
| ans-20-filter-empty | answer/answer ✓ | 1.000 | 1.000 | 2/1/1/0 | 0.625 | 4/4 | 13595ms |
| dbg-01-merge-no-output | debug/debug ✓ | 0.000 | 0.000 | 3/0/0/0 | 1.000 | 0/0 | 24595ms |
| dbg-02-loop-infinite | debug/debug ✓ | 0.000 | 0.000 | 2/1/0/0 | 0.833 | 2/2 | 23510ms |
| dbg-03-webhook-no-response | debug/debug ✓ | 1.000 | 0.750 | 3/0/0/0 | 1.000 | 7/7 | 13936ms |
| dbg-04-if-misroute | debug/debug ✓ | 1.000 | 1.000 | 3/0/0/0 | 1.000 | 3/3 | 15389ms |
| dbg-05-code-syntax | debug/debug ✓ | 1.000 | 0.250 | 3/0/0/0 | 1.000 | 2/2 | 14674ms |
| rdr-01-weather | redirect/redirect ✓ | — | — | — | — | — | 3363ms |
| rdr-02-forex | redirect/redirect ✓ | — | — | — | — | — | 3244ms |
| rdr-03-generic-python | redirect/answer ✗ | — | — | — | — | — | 11538ms |
| rdr-04-zapier-compare | redirect/answer ✗ | — | — | — | — | — | 6115ms |
| rdr-05-recipe | redirect/redirect ✓ | — | — | — | — | — | 3087ms |

## Notes

- Every row is a real HTTP request to the endpoint above. Mode and retrieved doc ids are the endpoint's own report (`X-Coach-Mode` / `X-Coach-Docs`), not a re-derivation by the harness.
- Latency is end-to-end wall clock: gate + Voyage embed + rerank + full Sonnet stream. It is not comparable to the pre-2026-07-13 reports, which timed a different code path.
- Faithfulness is the LLM-judge (Haiku 4.5, 3-pass consensus, conservative tie-break), scored on the answer the deployed app actually streamed — including refusals it should not have made. Weighting: supported=1.0, partial=0.5, unsupported=0.0, contradicted=−0.5 (clamped to [0,1]).
- Citation validity is scored per LINK (valid ÷ found), not as a mean of per-query rates. A per-query mean would score a refusal that cites nothing as a perfect 1.0, rewarding the app for failing to answer.
- Recall@5 is null for queries with empty `expected_doc_ids` and for redirect-labelled queries.