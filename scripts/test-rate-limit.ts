// Smoke test for the per-IP gate.
//
// Fires 12 requests as one caller and expects the 11th+ to be refused, THEN proves the
// bucket cannot be reset by forging a header. The previous version of this script sent
// `x-forwarded-for`, which the limiter no longer reads: it would have gone on reporting
// a clean pass while testing nothing at all.
//
// Requires a dev server with FORCE_RATE_LIMIT=1.
import crypto from "node:crypto";

const URL = process.env.TEST_URL ?? "http://localhost:3000/api/chat";

// The header Vercel sets and a client cannot. This is what the limiter keys on.
const TRUSTED_IP = "x-vercel-forwarded-for";

async function fire(i: number, headers: Record<string, string>) {
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
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  await res.text(); // drain so the connection closes
  return res.status;
}

async function main() {
  console.log("1. twelve requests from one caller (expect 10 x 200, then 429):");
  const results: number[] = [];
  for (let i = 1; i <= 12; i++) {
    const status = await fire(i, { [TRUSTED_IP]: "203.0.113.99" });
    results.push(status);
    console.log(`   req ${i}: ${status}`);
  }
  const ok = results.filter((s) => s === 200).length;
  const blocked = results.filter((s) => s === 429).length;
  const limitWorks = ok === 10 && blocked === 2;
  console.log(`   ${ok} x 200, ${blocked} x 429 -> ${limitWorks ? "PASS" : "FAIL"}`);

  // The whole point of the header change. A caller who is already blocked tries to mint
  // a fresh bucket by forging x-forwarded-for. It must stay blocked.
  console.log("\n2. same caller forges x-forwarded-for to escape the block:");
  const spoofed = await fire(99, {
    [TRUSTED_IP]: "203.0.113.99",
    "x-forwarded-for": "198.51.100.1",
  });
  const spoofBlocked = spoofed === 429;
  console.log(`   forged x-forwarded-for: ${spoofed} -> ${spoofBlocked ? "PASS (still blocked)" : "FAIL (bucket reset, limiter bypassed)"}`);

  // Control: a genuinely different caller must still get through, or we have built a
  // global lock rather than a per-IP limit.
  console.log("\n3. control: a different trusted IP is NOT blocked:");
  const other = await fire(100, { [TRUSTED_IP]: "198.51.100.77" });
  const otherOk = other === 200;
  console.log(`   different caller: ${other} -> ${otherOk ? "PASS" : "FAIL (limit is global, not per-IP)"}`);

  if (limitWorks && spoofBlocked && otherOk) {
    console.log("\n✓ per-IP limit holds and cannot be reset by a forged header");
    process.exit(0);
  }
  console.error("\n✗ gate did not behave as specified");
  process.exit(1);
}

main();
