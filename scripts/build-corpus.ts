import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import matter from "gray-matter";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const REPO_URL = "https://github.com/n8n-io/n8n-docs.git";
const CACHE_DIR = path.resolve(".cache/n8n-docs");
const RENDER_CACHE = path.resolve(".cache/rendered");
const OUT = path.resolve("data/corpus.json");

/**
 * THE GITBOOK INCLUDE PROBLEM.
 *
 * n8n's docs moved to GitBook, and a page body is now often nothing but a reusable include:
 *
 *   {% include "https://app.gitbook.com/s/GixZThfitWP21x2gQFpD/~/reusable/A6AUEJWQnhjgrypgRNwY/" %}
 *
 * The markdown in the repo therefore does NOT contain the page's text. `n8n-nodes-base.code`
 * -- the CODE NODE, one of the most-asked nodes in n8n -- ingests as a 465-character stub that
 * does not contain the words "once for" anywhere, which is why the coach could not explain
 * "Run Once for All Items" and why two eval rows pointed at a gold page that cannot answer
 * them.
 *
 * The include id is opaque and the checkout carries NO mapping from it to a file: the id
 * appears nowhere except in the pages that reference it, and matching the 343 files in
 * `reusable-content/.gitbook/includes/` back to their pages by path resolves 2 of 525.
 *
 * So the content is taken from the RENDERED page, which is the thing a reader actually sees
 * and the thing our citation URL points at. Only pages the include actually guts are fetched
 * (a page with its own 3 KB of text plus one shared hint block loses nothing worth a request),
 * and every fetch is cached on disk so a rebuild is not a re-crawl.
 */
const THIN_PAGE_CHARS = 1500;
const FETCH_DELAY_MS = 300;

const INCLUDE_RE = /\{%\s*include\s+"[^"]*"\s*%\}/g;

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function renderedBody(url: string): Promise<string | null> {
  fs.mkdirSync(RENDER_CACHE, { recursive: true });

  // n8n PUBLISHES a clean markdown rendering of every page: append `.md` to the page URL.
  // (The rendered page says so itself, and points at /llms.txt.) That is the authoritative
  // include-resolved text, written to be read by a model — strictly better than scraping the
  // HTML and turning it back into markdown, which drags in nav furniture and turndown
  // artefacts. The HTML path stays as a fallback for any page that does not serve a .md.
  const mdUrl = `${url.replace(/\/$/, "")}.md`;
  const md = await cachedFetch(mdUrl, "md");
  if (md) return stripDocsBanner(md);

  const html = await cachedFetch(url, "html");
  if (!html) return null;
  const $ = cheerio.load(html);
  $("nav, header, footer, script, style, aside, svg, button").remove();
  const main = $("main").first();
  const target = main.length ? main : $("body");
  return turndown.turndown(target.html() ?? "").trim() || null;
}

async function cachedFetch(url: string, ext: string): Promise<string | null> {
  const key = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  const cached = path.join(RENDER_CACHE, `${key}.${ext}`);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf8") || null;

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (dts-n8n-coach)" } });
  await sleep(FETCH_DELAY_MS);
  if (!res.ok) {
    fs.writeFileSync(cached, ""); // cache the miss; do not re-ask on every rebuild
    return null;
  }
  const body = await res.text();
  fs.writeFileSync(cached, body);
  return body;
}

/**
 * Every .md rendering opens with the same two-line pointer to llms.txt. Embedding 178 copies
 * of an identical preamble teaches the index nothing and gives every one of those chunks the
 * same head — a small but free retrieval-dilution risk. Drop it.
 */
function stripDocsBanner(md: string): string {
  return md
    .replace(/^>\s*For the complete documentation index[\s\S]*?\n\n/, "")
    .trim();
}

/**
 * WHAT THE COACH IS ALLOWED TO KNOW.
 *
 * The 2026-04 corpus took core/cluster/trigger nodes plus `docs/workflows` and `docs/code`.
 * That left the coach with 107 trigger-node pages, 102 LangChain pages, and ZERO app-node
 * pages — no Google Sheets, no Gmail, no Slack. It could not answer a question about the
 * nodes people actually use, and it had no hosting, expression, or binary-data documentation
 * either, so it refused (correctly, but uselessly) on whole classes of real questions.
 *
 * n8n has also RESTRUCTURED the docs tree since: `docs/workflows` and `docs/code` are gone
 * upstream (their GitHub paths 404), replaced by `docs/build`; hosting now lives under
 * `docs/deploy`. The old paths still serve on docs.n8n.io as redirects, so old citations are
 * not broken — but the content was frozen against a tree that no longer exists.
 *
 * `builtin/credentials` (327 near-identical "how to authenticate with X" pages) is
 * deliberately EXCLUDED for now: that much boilerplate competing in a top-50 vector pool is
 * a retrieval-dilution risk, and it should be added only with a measurement to back it.
 */
const TARGETS = [
  { dir: "docs/integrations/builtin/core-nodes", category: "core-nodes" },
  { dir: "docs/integrations/builtin/cluster-nodes", category: "cluster-nodes" },
  { dir: "docs/integrations/builtin/trigger-nodes", category: "trigger-nodes" },
  { dir: "docs/integrations/builtin/app-nodes", category: "app-nodes" },
  { dir: "docs/build", category: "build" },
  { dir: "docs/deploy", category: "deploy" },
  { dir: "docs/connect", category: "connect" },
  { dir: "docs/administer", category: "administer" },
  { dir: "docs/privacy-and-security", category: "privacy-and-security" },
];

function ensureClone() {
  if (fs.existsSync(CACHE_DIR)) {
    console.log(`✓ cache exists: ${CACHE_DIR}`);
    return;
  }
  fs.mkdirSync(path.dirname(CACHE_DIR), { recursive: true });
  console.log(`cloning ${REPO_URL} → ${CACHE_DIR}`);
  execSync(`git clone --depth=1 ${REPO_URL} ${CACHE_DIR}`, { stdio: "inherit" });
}

function walkMarkdown(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

/**
 * WHY THIS FILE CHUNKS.
 *
 * `formatContext` puts the WHOLE content of every retrieved doc into the prompt, and
 * `lib/budget.ts` reserves against a fixed `PROMPT_OVERHEAD_TOKENS` constant that stands in
 * for "5 retrieved doc chunks". With the old corpus (median 1.6 KB/doc) that was roughly
 * honest. The current docs tree contains `n8n-nodes-base.form.md` at 80,777 chars — ~20k
 * tokens in ONE document. Five such hits would cost an order of magnitude more than the
 * gate reserved, so the daily ceiling would under-book every one of them.
 *
 * It is also bad retrieval: an 80 KB page embedded as a single vector is a blurry average of
 * everything on it. It matches nothing precisely and drowns what it does match.
 *
 * So a document is split on its headings into chunks of at most MAX_CHUNK_CHARS. Only a doc
 * that actually splits gets a `__cNN` suffix, so every single-chunk doc KEEPS the id it had
 * (existing gold labels and embedded rows stay valid). Each chunk carries the page title, so
 * a chunk lifted out of its page still says what page it is from — and `docs_url` is the
 * parent page for every chunk of it, so a citation still lands on the right page.
 */
const MAX_CHUNK_CHARS = 6_000;

function chunkBody(body: string): string[] {
  if (body.length <= MAX_CHUNK_CHARS) return [body];

  // Split before each top-level-ish heading, keeping the heading with its section.
  const sections = body.split(/\n(?=#{2,3}\s)/);
  const chunks: string[] = [];
  let cur = "";

  const flush = () => {
    if (cur.trim()) chunks.push(cur.trim());
    cur = "";
  };

  for (const section of sections) {
    // A single section that is itself oversized (a giant parameter table) is hard-split on
    // paragraph boundaries — never mid-sentence, and never silently dropped.
    if (section.length > MAX_CHUNK_CHARS) {
      flush();
      let rest = section;
      while (rest.length > MAX_CHUNK_CHARS) {
        const cut = rest.lastIndexOf("\n\n", MAX_CHUNK_CHARS);
        const at = cut > MAX_CHUNK_CHARS * 0.5 ? cut : MAX_CHUNK_CHARS;
        chunks.push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      cur = rest;
      continue;
    }
    if (cur.length + section.length > MAX_CHUNK_CHARS) flush();
    cur += (cur ? "\n" : "") + section;
  }
  flush();

  return chunks.filter(Boolean);
}

function deriveTitle(data: Record<string, unknown>, body: string, file: string): string {
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(file, ".md").replace(/[-_.]/g, " ");
}

function toDocsUrl(repoPath: string): string {
  // docs/integrations/builtin/core-nodes/foo/bar.md → https://docs.n8n.io/integrations/builtin/core-nodes/foo/bar/
  let rel = repoPath.replace(/^docs\//, "").replace(/\.md$/, "");
  // A folder's landing page is served at the FOLDER url. n8n renamed those files from
  // `index.md` to `README.md` in the restructure, and stripping only `/index` published
  // `.../n8n-nodes-base.httprequest/README/` — a live 404 — as the citation URL for the
  // HTTP Request node. Verified: that URL 404s, `.../n8n-nodes-base.httprequest/` is 200.
  // Every citation the app emits is resolved from this field, so a mistake here is a
  // broken link handed to a stranger, not a cosmetic bug.
  rel = rel.replace(/\/(index|README)$/, "");
  return `https://docs.n8n.io/${rel}/`;
}

function toGithubUrl(repoPath: string): string {
  return `https://github.com/n8n-io/n8n-docs/blob/main/${repoPath}`;
}

async function main() {
  ensureClone();

  let fetched = 0;
  let gained = 0;

  const entries: Array<{
    id: string;
    title: string;
    category: string;
    repo_path: string;
    docs_url: string;
    github_url: string;
    content: string;
  }> = [];

  for (const { dir, category } of TARGETS) {
    const abs = path.join(CACHE_DIR, dir);
    const files = walkMarkdown(abs);
    console.log(`  ${category}: ${files.length} files`);

    for (const file of files) {
      const raw = fs.readFileSync(file, "utf8");
      const { data, content } = matter(raw);
      const repo_path = path.relative(CACHE_DIR, file);

      // The include directive is not content. Strip it, then ask what is actually left.
      let body = content.replace(INCLUDE_RE, "").trim();
      const docsUrl = toDocsUrl(repo_path);

      if (body.length < THIN_PAGE_CHARS && INCLUDE_RE.test(content)) {
        INCLUDE_RE.lastIndex = 0; // a /g regex's .test() is stateful; a stale index skips pages
        const rendered = await renderedBody(docsUrl);
        // Only take the rendered page if it is actually MORE than what we had. A fetch that
        // comes back thinner (a redirect to an index, a JS-only shell) must never silently
        // replace real content with less of it.
        if (rendered && rendered.length > body.length) {
          fetched++;
          gained += rendered.length - body.length;
          body = rendered;
        }
      }
      INCLUDE_RE.lastIndex = 0;

      if (body.length < 50) continue; // skip nearly-empty stubs

      const baseId = repo_path.replace(/[/.]/g, "__").replace(/__md$/, "");
      const title = deriveTitle(data, body, file);
      const chunks = chunkBody(body);

      chunks.forEach((chunk, i) => {
        const single = chunks.length === 1;
        entries.push({
          // A doc that fits in one chunk keeps its original id. Only a split doc is suffixed.
          id: single ? baseId : `${baseId}__c${String(i + 1).padStart(2, "0")}`,
          title,
          category,
          repo_path,
          docs_url: docsUrl,
          github_url: toGithubUrl(repo_path),
          // The page title rides with every chunk: a section pulled out of its page must
          // still say which page it came from, or the model cites a heading with no subject.
          content: single ? chunk : `# ${title}\n\n${chunk}`,
        });
      });
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(entries, null, 2));

  const totalChars = entries.reduce((a, e) => a + e.content.length, 0);
  console.log(`\n✓ wrote ${entries.length} entries to ${OUT}`);
  console.log(`  rendered-page fallback: ${fetched} gutted pages recovered, +${(gained / 1024).toFixed(0)} KB`);
  console.log(`  total content: ${(totalChars / 1024).toFixed(1)} KB`);
  console.log(`  avg entry: ${Math.round(totalChars / entries.length)} chars`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
