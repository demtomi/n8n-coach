// Smoke test: fires 12 requests, expects the 11th+ to return 429.
// Requires dev server with FORCE_RATE_LIMIT=1 set.
import crypto from "node:crypto";

const URL = process.env.TEST_URL ?? "http://localhost:3000/api/chat";

async function fire(i: number) {
  const body = {
    messages: [
      {
        id: `rl-${i}-${crypto.randomUUID()}`,
        role: "user",
        parts: [{ type: "text", text: "ping" }],
      },
    ],
  };
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.99", // fixed test IP
    },
    body: JSON.stringify(body),
  });
  // Drain body so connection closes quickly
  await res.text();
  return res.status;
}

async function main() {
  const results: Array<{ i: number; status: number }> = [];
  for (let i = 1; i <= 12; i++) {
    const status = await fire(i);
    results.push({ i, status });
    console.log(`  req ${i}: ${status}`);
  }

  const blocked = results.filter((r) => r.status === 429);
  const ok = results.filter((r) => r.status === 200);
  console.log(`\n${ok.length} x 200, ${blocked.length} x 429`);

  if (ok.length === 10 && blocked.length === 2) {
    console.log("✓ rate limit works: first 10 ok, 11+12 blocked");
    process.exit(0);
  } else {
    console.error("✗ unexpected distribution");
    process.exit(1);
  }
}

main();
