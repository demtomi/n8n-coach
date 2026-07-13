import crypto from "node:crypto";

/**
 * Identify the caller from a header the CLIENT CANNOT SET.
 *
 * `x-vercel-forwarded-for` is populated by Vercel's edge and is not attacker-writable.
 * The leftmost value of `x-forwarded-for` IS attacker-writable, so keying the limiter on
 * it (as this used to) handed out a fresh 10/min + 100/day bucket for every random string
 * an attacker cared to send.
 *
 * If no trusted header is present we log LOUDLY rather than silently collapsing every
 * visitor into one shared bucket, which would rate-limit the whole world to 10/min
 * together and make the demo look broken to a prospect. Verify this on the first prod
 * deploy by grepping the logs for the warning below; its absence is the passing signal.
 */
export function ipHashFromRequest(req: Request): string {
  const trusted =
    req.headers.get("x-vercel-forwarded-for") || req.headers.get("x-real-ip");

  if (!trusted) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[rate-limit] NO TRUSTED IP HEADER — all callers are sharing one bucket. The per-IP limit is not working."
      );
    }
    return crypto.createHash("sha256").update("local").digest("hex").slice(0, 32);
  }

  return crypto.createHash("sha256").update(trusted).digest("hex").slice(0, 32);
}
