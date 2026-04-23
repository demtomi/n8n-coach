import { retrieve } from "../lib/rag";

async function main() {
  const query = process.argv.slice(2).join(" ");
  if (!query) {
    console.error("usage: tsx scripts/test-rag.ts <query>");
    process.exit(1);
  }

  console.log(`query: "${query}"\n`);
  const results = await retrieve(query, 5);
  for (const [i, r] of results.entries()) {
    console.log(`${i + 1}. [${r.similarity.toFixed(3)}] ${r.title}  (${r.category})`);
    console.log(`   ${r.docs_url}`);
    console.log(`   ${r.content.slice(0, 140).replace(/\s+/g, " ")}...`);
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
