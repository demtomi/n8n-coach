import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import matter from "gray-matter";

const REPO_URL = "https://github.com/n8n-io/n8n-docs.git";
const CACHE_DIR = path.resolve(".cache/n8n-docs");
const OUT = path.resolve("data/corpus.json");

const TARGETS = [
  { dir: "docs/integrations/builtin/core-nodes", category: "core-nodes" },
  { dir: "docs/integrations/builtin/cluster-nodes", category: "cluster-nodes" },
  { dir: "docs/integrations/builtin/trigger-nodes", category: "trigger-nodes" },
  { dir: "docs/workflows", category: "workflows" },
  { dir: "docs/code", category: "code" },
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

function deriveTitle(data: Record<string, unknown>, body: string, file: string): string {
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const h1 = body.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(file, ".md").replace(/[-_.]/g, " ");
}

function toDocsUrl(repoPath: string): string {
  // docs/integrations/builtin/core-nodes/foo/bar.md → https://docs.n8n.io/integrations/builtin/core-nodes/foo/bar/
  let rel = repoPath.replace(/^docs\//, "").replace(/\.md$/, "");
  rel = rel.replace(/\/index$/, "");
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

      entries.push({
        id: repo_path.replace(/[/.]/g, "__").replace(/__md$/, ""),
        title: deriveTitle(data, body, file),
        category,
        repo_path,
        docs_url: toDocsUrl(repo_path),
        github_url: toGithubUrl(repo_path),
        content: body,
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
