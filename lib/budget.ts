import { db, num } from "./db";
import { MAX_OUTPUT_TOKENS } from "./limits";

/**
 * The global daily spend ceiling, in cents.
 *
 * Per-IP limits are not a cost control on a public endpoint: IPs rotate, so
 * "100/day per IP" multiplies by an unbounded number of IPs. This is the number that
 * actually stops the bill. plan.md promised it on day one and it was never built.
 *
 * Read lazily, not at module scope (project CLAUDE.md: module-scope env reads break
 * Vercel builds). A junk value must not silently disable the ceiling or, worse, make
 * every comparison NaN-false and refuse every request.
 */
function dailyBudgetCents(): number {
  const raw = process.env.COACH_DAILY_BUDGET_CENTS;
  if (!raw) return 300; // USD 3.00/day
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.error(
      `[budget] COACH_DAILY_BUDGET_CENTS is not a positive number ("${raw}"); falling back to 300c`
    );
    return 300;
  }
  return n;
}

// Claude Sonnet 4.6 list price, USD per million tokens.
const USD_PER_MTOK = {
  input: 3.0,
  output: 15.0,
  cacheWrite: 3.75,
  cacheRead: 0.3,
} as const;

export type Usage = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
};

export function costCents(u: Usage): number {
  const usd =
    (u.inputTokens * USD_PER_MTOK.input +
      u.outputTokens * USD_PER_MTOK.output +
      u.cacheWriteTokens * USD_PER_MTOK.cacheWrite +
      u.cacheReadTokens * USD_PER_MTOK.cacheRead) /
    1_000_000;
  return usd * 100;
}

// What we put on the books BEFORE doing the work. Deliberately pessimistic: assume the
// model writes to its output ceiling. Over-reserving is safe (we refund at settle time);
// under-reserving is how a ceiling gets overshot.
const PROMPT_OVERHEAD_TOKENS = 5_000; // vocab primer + system rules + 5 retrieved doc chunks
const CHARS_PER_TOKEN = 3.5; // conservative for JSON-heavy text

export function reserveCents(inputChars: number): number {
  return costCents({
    inputTokens: Math.ceil(inputChars / CHARS_PER_TOKEN) + PROMPT_OVERHEAD_TOKENS,
    outputTokens: MAX_OUTPUT_TOKENS,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
  });
}

export type GateRefusalCode = "rate_minute" | "rate_day" | "budget" | "unavailable";

export type GateResult =
  | { ok: true; minuteUsed: number; dayUsed: number; spentCents: number; reservedCents: number }
  | {
      ok: false;
      status: number;
      // The human sentence the caller sees.
      reason: string;
      // The machine-readable reason, surfaced as X-Coach-Gate. A caller (the eval harness)
      // must be able to tell "you are going too fast, wait" from "the ceiling is spent" —
      // the first is safe to retry, the second must abort the run rather than silently
      // report a partial result as a full one.
      code: GateRefusalCode;
      minuteUsed: number;
      dayUsed: number;
    };

const MESSAGES: Record<string, string> = {
  rate_minute: "Too many requests this minute. Try again in a moment.",
  rate_day: "Daily limit reached (100 messages). Come back tomorrow.",
  budget:
    "The coach has hit its daily usage budget. It resets at midnight UTC. Try again tomorrow.",
};

/**
 * One round trip: per-IP rate limit + global ceiling + spend reservation, atomically.
 *
 * Fails CLOSED. If we cannot reach the ledger we do not know what we have spent, and
 * unknown must mean unsafe. The previous version of this returned "allowed" on any
 * Supabase error, which meant the sole control between the open internet and real
 * Anthropic spend removed itself the instant its own dependency hiccuped.
 */
export async function checkAndReserve(
  ipHash: string,
  inputChars: number
): Promise<GateResult> {
  const reserved = reserveCents(inputChars);

  let row:
    | { allowed: boolean; reason: string; minute_used: number; day_used: number; spend_cents: string }
    | undefined;

  try {
    const rows = await db()`
      select allowed, reason, minute_used, day_used, spend_cents
      from coach_check_and_reserve(
        ${ipHash}::text,
        ${num(dailyBudgetCents())}::numeric,
        ${num(reserved)}::numeric
      )
    `;
    row = rows[0] as typeof row;
  } catch (err) {
    console.error("[budget] gate query FAILED — refusing request (fail closed)", err);
    return {
      ok: false,
      status: 503,
      reason: "The coach is briefly unavailable. Try again in a moment.",
      code: "unavailable",
      minuteUsed: 0,
      dayUsed: 0,
    };
  }

  // A gate that returns no row told us nothing about what we have spent, and unknown must
  // mean unsafe. Same branch as a thrown error.
  if (!row) {
    console.error("[budget] gate returned no row — refusing request (fail closed)");
    return {
      ok: false,
      status: 503,
      reason: "The coach is briefly unavailable. Try again in a moment.",
      code: "unavailable",
      minuteUsed: 0,
      dayUsed: 0,
    };
  }

  const minuteUsed = row.minute_used ?? 0;
  const dayUsed = row.day_used ?? 0;
  const spentCents = Number(row.spend_cents ?? 0);

  if (!row.allowed) {
    const reason: string = row.reason;
    if (reason === "budget") {
      console.error(
        `[budget] DAILY CEILING HIT: ${spentCents.toFixed(1)}c >= ${dailyBudgetCents()}c. Refusing until UTC midnight.`
      );
    }
    // An UNKNOWN reason code degrades to "budget", the non-retryable one. Guessing
    // "rate_minute" would invite a caller to retry a refusal it does not understand.
    const code: GateRefusalCode =
      reason === "rate_minute" || reason === "rate_day" || reason === "budget"
        ? reason
        : "budget";
    return {
      ok: false,
      status: 429,
      reason: MESSAGES[reason] ?? MESSAGES.budget,
      code,
      minuteUsed,
      dayUsed,
    };
  }

  return { ok: true, minuteUsed, dayUsed, spentCents, reservedCents: reserved };
}

/**
 * Swap the reservation for what the turn actually cost.
 *
 * If this never runs (client aborted the stream, lambda froze), the reservation simply
 * stays on the books. That is the safe direction: the ledger over-counts and the ceiling
 * still holds. The old check-then-record design failed the other way, so an attacker who
 * aborted every request spent real money that was never recorded at all.
 */
export async function settleUsage(reservedCents: number, u: Usage): Promise<void> {
  const actual = costCents(u);

  try {
    await db()`
      select coach_settle_usage(
        ${num(reservedCents)}::numeric,
        ${num(u.inputTokens)}::bigint,
        ${num(u.outputTokens)}::bigint,
        ${num(u.cacheWriteTokens)}::bigint,
        ${num(u.cacheReadTokens)}::bigint,
        ${num(actual)}::numeric
      )
    `;
  } catch (err) {
    // Loud on purpose. A silent failure here leaves the (pessimistic) reservation in
    // place, which is safe for the wallet but means the ledger reads high.
    console.error("[budget] settle FAILED — the reservation stands, ledger reads high", err);
  }
}
