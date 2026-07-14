import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";

const REPO_URL = "https://github.com/n8n-io/n8n-docs.git";
const CACHE_DIR = path.resolve(".cache/n8n-docs");
const OUT = path.resolve("data/corpus.json");

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

function main() {
  ensureClone();

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
      const body = content.trim();
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
          docs_url: toDocsUrl(repo_path),
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
  console.log(`  total content: ${(totalChars / 1024).toFixed(1)} KB`);
  console.log(`  avg entry: ${Math.round(totalChars / entries.length)} chars`);
}

main();
