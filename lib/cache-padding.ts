/**
 * Static n8n vocabulary primer used as the prompt-cache prefix.
 *
 * Why: Claude Sonnet 4.6 requires a minimum 2,048-token block for ephemeral
 * cache to engage. BASE_SYSTEM alone (~330 tokens) falls below the floor and
 * caching silently no-ops. This primer pads the cached prefix above the floor
 * AND doubles as useful grounding for the model on n8n node names, expression
 * syntax, and common patterns.
 *
 * Stability: this content MUST stay byte-identical across requests, otherwise
 * the cache key invalidates. Treat edits like a schema change.
 */
export const N8N_VOCAB_PRIMER = `<n8n_reference_primer>
The following is a static reference about n8n's core surfaces. Use it to ground node names, expression syntax, and execution semantics when answering. This primer is part of every system prompt and never changes between requests.

## Trigger nodes (start workflows)

- Manual Trigger: fires on user click. Default starting node for testing.
- Webhook: HTTP endpoint. Modes: GET, POST, PUT, DELETE, PATCH, HEAD. Returns immediately or waits for "Respond to Webhook" node. Has a Test URL (Editor) and Production URL.
- Schedule Trigger: cron-style. Supports interval, every X minutes/hours/days/weeks/months, or custom cron expression. Uses workflow timezone.
- Email Trigger (IMAP): polls a mailbox for new messages.
- n8n Form Trigger: hosts a public web form. Multi-step forms supported.
- Chat Trigger: webhook for chat-style interactions, used with AI Agent.
- Error Trigger: fires when another workflow errors. Used to build error-handling workflows.
- Execute Workflow Trigger: lets one workflow be called as a subworkflow from another (Execute Workflow node calls it).

## Core action nodes

- HTTP Request: generic REST client. Methods, headers, query params, body (JSON / form / binary), authentication (Basic, Header, OAuth1, OAuth2, Predefined credential types, Generic).
- Code: runs JavaScript or Python. Modes: "Run Once for All Items" (default) or "Run Once for Each Item". Access incoming items via $input.all() / $input.item.
- Set: assigns or transforms fields on items. Use "Keep Only Set" to drop everything else. Modes: Manual Mapping or JSON.
- Edit Fields (alias of Set in newer versions): same node.
- IF: binary branch based on condition. Two outputs: true / false.
- Switch: multi-branch based on rules or expression. Up to N outputs.
- Merge: combines two inputs. Modes: Append, Combine (by position, by key, multiplex), Choose Branch, SQL Query, Compare Datasets.
- Loop Over Items (formerly Split In Batches): processes items in batches. Has two outputs: done / loop.
- Aggregate: collapses multiple items into one, grouping by field or aggregating arrays.
- Item Lists: split arrays into items, concatenate items, sort, limit, remove duplicates, summarize.
- Filter: keeps only items matching a condition. Drops the rest.
- Wait: pauses a workflow. Modes: time interval, until time, webhook resume.
- Respond to Webhook: ends a webhook workflow with a custom response. Required when webhook is set to "When Last Node Finishes" mode.
- Execute Workflow: calls a subworkflow. Passes input items; receives output items back.
- Stop and Error: throws an error from a workflow. Used to mark failures.
- No Operation, Do Nothing: passes items through untouched. Used for branching joins.
- Compare Datasets: compares two inputs side-by-side. Outputs: A only, B only, both, different.
- Date & Time: format, parse, add/subtract durations on dates. Luxon-based under the hood.
- Crypto: hash, HMAC, encrypt, decrypt, random bytes, JWT verify.

## AI / LangChain nodes (n8n.langchain.* namespace)

- AI Agent: orchestrates tool calls. Has sub-nodes for Chat Model, Memory, Tools, Output Parser. Modes: Tools Agent (default), Conversational, OpenAI Functions, ReAct, Plan and Execute, SQL.
- OpenAI: GPT family. Models: gpt-4o, gpt-4o-mini, o1, o1-mini, gpt-4-turbo, gpt-3.5-turbo. Endpoints: Chat Completion, Image generation (DALL-E), Audio transcription/TTS.
- Anthropic Chat Model: Claude family. Use with AI Agent. Set via API key credential.
- Google Gemini Chat Model: Gemini 1.5/2.x family.
- Ollama Chat Model: self-hosted local models.
- Embeddings OpenAI / Embeddings Cohere / Embeddings Hugging Face: vectorize text.
- Vector Store: in-memory, Pinecone, Supabase, Qdrant, Weaviate, Chroma, MongoDB Atlas, PGVector, Redis.
- Document Loader: file loader, web scraper, JSON loader, GitHub loader.
- Text Splitter: recursive character splitter, token splitter, character splitter.
- Memory: Buffer Window, Buffer, Postgres Chat Memory, Redis Chat Memory, Motorhead, Zep, Xata.
- Output Parser: structured (Zod schema), auto-fixing, item list.
- Information Extractor: extracts structured fields from free text via LLM.
- Text Classifier: classifies text into categories via LLM.
- Sentiment Analysis: positive / negative / neutral via LLM.

## Common integrations

- Google Sheets: append, update, delete, read rows. Sheet ID + sheet name + range.
- Notion: create / update / append blocks; query database with filter and sort.
- Airtable: search records, create, update, delete. Uses base + table + field IDs.
- Slack: post message, upload file, lookup user, manage channels.
- Discord: send message (via webhook or bot), manage channels.
- Telegram: send message, send photo, set webhook, inline keyboards.
- Gmail: send, draft, label, search, mark as read.
- Microsoft Outlook / Microsoft Teams / Microsoft Graph: similar surface.
- HubSpot / Pipedrive / Salesforce: CRM contacts, deals, activities.
- Stripe: customers, charges, subscriptions, webhooks.
- AWS S3 / Google Cloud Storage / Azure Storage Blob: file ops.
- Postgres / MySQL / MongoDB / Redis: database ops.
- GitHub / GitLab: issues, PRs, commits, releases.

## Expression syntax (n8n's templating language)

- Wrap expressions in \`={{ ... }}\` (note the leading equals sign — required in n8n's UI).
- \`{{ $json.fieldName }}\`: current item's JSON field.
- \`{{ $json["field with spaces"] }}\`: bracket notation.
- \`{{ $input.first().json.x }}\`: first input item.
- \`{{ $input.all() }}\`: all incoming items as array.
- \`{{ $input.item.json.x }}\` (Run Once for Each Item only): the current item.
- \`{{ $node["Node Name"].json.x }}\`: reach back into a named node.
- \`{{ $node["Webhook"].json.body.email }}\`: deep field access.
- \`{{ $now }}\`: current Luxon DateTime in workflow timezone.
- \`{{ $today }}\`: today at 00:00 in workflow timezone.
- \`{{ $now.toFormat('yyyy-MM-dd') }}\`: Luxon formatting.
- \`{{ $now.minus({ days: 7 }).toISO() }}\`: date math.
- \`{{ $env.MY_VAR }}\`: environment variable (must be in n8n config).
- \`{{ $vars.foo }}\`: workflow / instance variables (Cloud + self-host).
- \`{{ $execution.id }}\`: current execution ID.
- \`{{ $workflow.id }}\` / \`{{ $workflow.name }}\`: workflow metadata.
- \`{{ $itemIndex }}\`: index of current item.
- \`{{ $runIndex }}\`: which run within a loop iteration.
- \`{{ $secrets.namespace.key }}\`: external secrets (Vault, AWS Secrets Manager, etc.).
- String / array / number helpers via JMESPath-like dot chains: \`.split()\`, \`.map(x => ...)\`, \`.filter(x => ...)\`, \`.length\`, \`.toUpperCase()\`, \`.includes()\`, \`.replace()\`.

## Workflow concepts

- Item: the unit of data flowing between nodes. An item is { json: {...}, binary?: {...} }.
- Pinned data: lock a node's output during testing so re-runs don't re-fetch.
- Sticky Note: visual annotation; no execution.
- Sub-workflows: workflows called via Execute Workflow node. Pass items in, get items out.
- Error workflow: a workflow tagged as the error handler at the workflow-settings level. Fires on any error.
- Settings → "Continue On Fail": node skips errors and outputs an empty item.
- Settings → "Retry On Fail": auto-retry N times with M ms wait.
- Always Output Data: forces a node to emit at least one item even when upstream is empty.
- Execution Order: parallel branches run in declaration order. Use the new "v1" execution order in workflow settings for predictable behavior.
- Binary data: file content stored separately from json. Reference via \`{{ $binary.data }}\`.

## Credentials

- Created in Credentials > New. Each integration node references a credential by ID.
- Types: API Key, OAuth1, OAuth2, Basic Auth, Header Auth, Generic, plus per-integration types (Google Sheets OAuth2, Notion API, etc.).
- Credentials are encrypted at rest with N8N_ENCRYPTION_KEY.

## Hosting surfaces

- n8n Cloud: managed, Starter / Pro / Enterprise tiers.
- Self-hosted: Docker, Docker Compose, npm, Kubernetes. Single-instance and queue mode (worker + main with Redis).
- Workflow execution data retention: configured via EXECUTIONS_DATA_PRUNE / EXECUTIONS_DATA_MAX_AGE.

## Common debugging patterns

- "Execute Node" runs only one node using pinned upstream data.
- "Execute Workflow" runs the whole graph from triggers.
- Stop the workflow mid-execution via the toolbar.
- Re-run with same data via "Execute previous nodes" on a downstream node.
- Inspect execution list under Executions tab; click any to step through node outputs.

This primer is reference material. Apply it when explaining nodes, expressions, or patterns; cite docs.n8n.io URLs from retrieved_docs for specifics.
</n8n_reference_primer>`;
