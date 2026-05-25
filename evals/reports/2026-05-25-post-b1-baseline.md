# n8n Coach — Eval Report

Started: 2026-05-25T19:39:12.034Z
Finished: 2026-05-25T19:45:17.883Z
Queries: 30
Generation enabled: true

## Summary scores

| Metric | Value |
| --- | --- |
| Mode-routing accuracy | 0.933 |
| Mean recall@5 | 0.778 |
| Mean MRR@5 | 0.657 |
| Mean faithfulness (stub) | 0.657 |
| Mean citation validity | 0.754 |

## Per-query results

| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (stub) | Citations | Latency |
| --- | --- | --- | --- | --- | --- | --- |
| ans-01-merge-modes | answer/answer ✓ | 1.000 | 1.000 | 2/4 | 2/2 | 17286ms |
| ans-02-http-auth | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 2/4 | 16710ms |
| ans-03-loop-batch | answer/answer ✓ | 1.000 | 1.000 | 4/4 | 1/1 | 12323ms |
| ans-04-if-vs-switch | answer/answer ✓ | 1.000 | 0.750 | 2/4 | 3/3 | 11141ms |
| ans-05-expression-now | answer/answer ✓ | — | — | 4/4 | 2/2 | 13421ms |
| ans-06-webhook-response | answer/answer ✓ | 1.000 | 0.750 | 2/4 | 1/3 | 16545ms |
| ans-07-schedule-cron | answer/answer ✓ | 1.000 | 1.000 | 4/4 | 2/3 | 21395ms |
| ans-08-aggregate-vs-items | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 1/1 | 12324ms |
| ans-09-error-workflow | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 5/5 | 13958ms |
| ans-10-code-run-once | answer/answer ✓ | 0.000 | 0.000 | 2/4 | 2/3 | 13725ms |
| ans-11-pipedrive-paginate | answer/answer ✓ | 1.000 | 0.333 | 3/4 | 3/4 | 16845ms |
| ans-12-subworkflow-data | answer/answer ✓ | — | — | 3/4 | 3/3 | 18716ms |
| ans-13-credentials-encryption | answer/answer ✓ | — | — | 0/4 | 2/5 | 10755ms |
| ans-14-set-vs-edit-fields | answer/answer ✓ | 1.000 | 1.000 | 2/4 | 1/1 | 9325ms |
| ans-15-continue-on-fail | answer/answer ✓ | — | — | 1/4 | 0/1 | 9523ms |
| ans-16-langchain-agent-memory | answer/answer ✓ | 0.000 | 0.000 | 3/4 | 6/7 | 16557ms |
| ans-17-google-sheets-update | answer/answer ✓ | — | — | 1/4 | 1/2 | 12760ms |
| ans-18-binary-data | answer/answer ✓ | — | — | 2/4 | 2/3 | 13129ms |
| ans-19-self-host-queue-mode | answer/answer ✓ | — | — | 1/4 | 2/4 | 15868ms |
| ans-20-filter-empty | answer/answer ✓ | 1.000 | 1.000 | 2/4 | 1/1 | 16415ms |
| dbg-01-merge-no-output | debug/debug ✓ | 0.000 | 0.000 | 3/3 | 1/1 | 16714ms |
| dbg-02-loop-infinite | debug/debug ✓ | 0.000 | 0.000 | 3/3 | 1/1 | 16282ms |
| dbg-03-webhook-no-response | debug/debug ✓ | 1.000 | 0.750 | 3/3 | 1/3 | 14034ms |
| dbg-04-if-misroute | debug/debug ✓ | 1.000 | 1.000 | 3/3 | 1/1 | 13422ms |
| dbg-05-code-syntax | debug/debug ✓ | 1.000 | 0.250 | 2/3 | 2/3 | 10400ms |
| rdr-01-weather | redirect/redirect ✓ | — | — | — | — | 1302ms |
| rdr-02-forex | redirect/redirect ✓ | — | — | — | — | 1256ms |
| rdr-03-generic-python | redirect/answer ✗ | — | — | — | — | 1322ms |
| rdr-04-zapier-compare | redirect/answer ✗ | — | — | — | — | 993ms |
| rdr-05-recipe | redirect/redirect ✓ | — | — | — | — | 1399ms |

## Notes

- Faithfulness is the STUB scorer (keyword-overlap heuristic). LLM-judge replacement is open work in plan.md.
- Recall@5 is null for queries with empty expected_doc_ids — labeling is loose for those.
- Latency includes network + Supabase RPC + (optional) generation.