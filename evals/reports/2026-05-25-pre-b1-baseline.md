# n8n Coach — Eval Report

Started: 2026-05-25T19:22:44.243Z
Finished: 2026-05-25T19:27:15.213Z
Queries: 30
Generation enabled: true

## Summary scores

| Metric | Value |
| --- | --- |
| Mode-routing accuracy | 0.933 |
| Mean recall@5 | 0.722 |
| Mean MRR@5 | 0.681 |
| Mean faithfulness (stub) | 0.667 |
| Mean citation validity | 0.780 |

## Per-query results

| ID | Mode (exp / obs) | Recall@5 | MRR@5 | Faithful (stub) | Citations | Latency |
| --- | --- | --- | --- | --- | --- | --- |
| ans-01-merge-modes | answer/answer ✓ | 1.000 | 1.000 | 2/4 | 2/2 | 13535ms |
| ans-02-http-auth | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 1/3 | 10065ms |
| ans-03-loop-batch | answer/answer ✓ | 1.000 | 1.000 | 4/4 | 1/2 | 9319ms |
| ans-04-if-vs-switch | answer/answer ✓ | 1.000 | 0.750 | 2/4 | 3/3 | 8165ms |
| ans-05-expression-now | answer/answer ✓ | — | — | 4/4 | 2/2 | 11128ms |
| ans-06-webhook-response | answer/answer ✓ | 1.000 | 0.750 | 4/4 | 1/3 | 11577ms |
| ans-07-schedule-cron | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 3/3 | 9414ms |
| ans-08-aggregate-vs-items | answer/answer ✓ | 1.000 | 1.000 | 3/4 | 1/1 | 9192ms |
| ans-09-error-workflow | answer/answer ✓ | 1.000 | 1.000 | 4/4 | 3/3 | 12467ms |
| ans-10-code-run-once | answer/answer ✓ | 0.000 | 0.000 | 2/4 | 2/2 | 7905ms |
| ans-11-pipedrive-paginate | answer/answer ✓ | 0.000 | 0.000 | 3/4 | 3/4 | 15432ms |
| ans-12-subworkflow-data | answer/answer ✓ | — | — | 3/4 | 2/2 | 14582ms |
| ans-13-credentials-encryption | answer/answer ✓ | — | — | 1/4 | 2/4 | 9088ms |
| ans-14-set-vs-edit-fields | answer/answer ✓ | 1.000 | 1.000 | 1/4 | 1/1 | 5660ms |
| ans-15-continue-on-fail | answer/answer ✓ | — | — | 1/4 | 0/1 | 4862ms |
| ans-16-langchain-agent-memory | answer/answer ✓ | 0.000 | 0.000 | 2/4 | 6/6 | 11879ms |
| ans-17-google-sheets-update | answer/answer ✓ | — | — | 1/4 | 0/1 | 5779ms |
| ans-18-binary-data | answer/answer ✓ | — | — | 2/4 | 3/4 | 11630ms |
| ans-19-self-host-queue-mode | answer/answer ✓ | — | — | 1/4 | 2/3 | 9924ms |
| ans-20-filter-empty | answer/answer ✓ | 1.000 | 1.000 | 2/4 | 2/2 | 11876ms |
| dbg-01-merge-no-output | debug/debug ✓ | 0.000 | 0.000 | 3/3 | 2/2 | 14893ms |
| dbg-02-loop-infinite | debug/debug ✓ | 0.000 | 0.000 | 3/3 | 3/3 | 16604ms |
| dbg-03-webhook-no-response | debug/debug ✓ | 1.000 | 0.750 | 3/3 | 2/3 | 10801ms |
| dbg-04-if-misroute | debug/debug ✓ | 1.000 | 1.000 | 3/3 | 2/2 | 11058ms |
| dbg-05-code-syntax | debug/debug ✓ | 1.000 | 1.000 | 2/3 | 1/1 | 10187ms |
| rdr-01-weather | redirect/redirect ✓ | — | — | — | — | 574ms |
| rdr-02-forex | redirect/redirect ✓ | — | — | — | — | 2171ms |
| rdr-03-generic-python | redirect/answer ✗ | — | — | — | — | 402ms |
| rdr-04-zapier-compare | redirect/answer ✗ | — | — | — | — | 400ms |
| rdr-05-recipe | redirect/redirect ✓ | — | — | — | — | 398ms |

## Notes

- Faithfulness is the STUB scorer (keyword-overlap heuristic). LLM-judge replacement is open work in plan.md.
- Recall@5 is null for queries with empty expected_doc_ids — labeling is loose for those.
- Latency includes network + Supabase RPC + (optional) generation.