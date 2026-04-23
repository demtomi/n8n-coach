# Loom demo script — 90 seconds

> **Audience:** Upwork prospects, Build Room peers, LinkedIn connections.
> **Goal:** Show technical chops + problem framing in under 90 seconds. The live product does the selling.
> **URL to show:** `coach.tamasdemeter.com`

---

## Beat sheet (timing hints)

**0:00 – 0:12  |  Intro + stakes**
> "I built this in a weekend. It's an n8n coach — you ask it a question about n8n, or paste a broken workflow, and it gives you an answer grounded in the official docs. Let me show you."

Show: the empty state at `coach.tamasdemeter.com` with the 4 sample prompts.

---

**0:12 – 0:32  |  Demo 1 — Answer mode**
Click prompt: **"When should I use the Merge node vs Compare Datasets?"**

Narrate while it streams:
> "It embeds my question, searches 332 pages of the actual n8n docs repo, and feeds the top matches to Claude. Watch — every claim it makes links back to the specific page it came from."

Hover one of the citation links to show the tooltip URL (`docs.n8n.io/...`).

---

**0:32 – 1:05  |  Demo 2 — Debug mode (the killer feature)**
Click "+ New chat". Paste a workflow JSON prepared ahead of time (a deliberately broken one: missing credential + inconsistent `$json.x` references).

Narrate:
> "Now the real use case — I paste a broken workflow. It doesn't just answer a question, it diagnoses. What the workflow does, every issue it finds, which node, why it'll break citing the docs, and the exact fix."

Let it stream the structured diagnosis. Hover one of the "Fix:" callouts.

---

**1:05 – 1:18  |  Demo 3 — Guardrails**
Click "+ New chat". Type: **"what's the exchange rate for USD and HUF?"**

Narrate:
> "One thing you have to get right with an RAG chatbot — it shouldn't try to be helpful when it's out of scope. There's a similarity gate: if the question doesn't match the docs, it politely declines. No xe.com recommendations, no made-up answers."

Let the one-sentence redirect render.

---

**1:18 – 1:30  |  Wrap + CTA**
> "Next.js 16, Vercel AI SDK, Claude Sonnet 4.6, Voyage embeddings, Supabase pgvector, deployed on Vercel. Repo is open — link in the description. If you're running an n8n setup and want something like this for your own docs, DM me."

Show: URL + GitHub link.

---

## Props needed

- Browser window on `coach.tamasdemeter.com` (fresh chat)
- A deliberately broken n8n workflow JSON (save to clipboard before recording):

```json
{"nodes":[{"name":"Webhook","type":"n8n-nodes-base.webhook","parameters":{"path":"lead","httpMethod":"POST"}},{"name":"Send Email","type":"n8n-nodes-base.emailSend","parameters":{"toEmail":"{{ $json.email }}","subject":"Hi {{ $json.firstname }}","text":"Thanks {{ $json.name }}!"}}],"connections":{"Webhook":{"main":[[{"node":"Send Email","type":"main","index":0}]]}}}
```

## Tone

Flat, matter-of-fact. No hype. The artifact does the selling — just walk through it like you're showing a colleague, not pitching.

## Post-recording checklist

- [ ] Upload to Loom, set to unlisted-with-link
- [ ] Paste link on LinkedIn (Tamas's voice, sparring-partner style — "built this; here's what surprised me" framing)
- [ ] Post in Build Room (Skool) — idea/build post type
- [ ] Add to `tamasdemeter.com/portfolio` as a case study
- [ ] Update [Notion Tasks DB] with "n8n Coach — shipped" row
