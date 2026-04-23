import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

let _supabase: SupabaseClient | null = null;
function supabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    );
  }
  return _supabase;
}

export function ipHashFromRequest(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

export type RateLimitResult =
  | { ok: true; minuteUsed: number; dayUsed: number }
  | { ok: false; minuteUsed: number; dayUsed: number; reason: string };

export async function checkRateLimit(req: Request): Promise<RateLimitResult> {
  // Bypass in dev to keep local iteration fast
  if (process.env.NODE_ENV !== "production" && process.env.FORCE_RATE_LIMIT !== "1") {
    return { ok: true, minuteUsed: 0, dayUsed: 0 };
  }

  const ipHash = ipHashFromRequest(req);
  const { data, error } = await supabase().rpc("coach_check_rate_limit", {
    p_ip_hash: ipHash,
  });

  if (error) {
    console.error("[rate-limit] check failed, failing open", error);
    return { ok: true, minuteUsed: 0, dayUsed: 0 };
  }

  const row = Array.isArray(data) ? data[0] : data;
  const minuteUsed = row?.minute_used ?? 0;
  const dayUsed = row?.day_used ?? 0;

  if (!row?.allowed) {
    const reason =
      minuteUsed >= 10
        ? "Too many requests this minute. Try again in a moment."
        : "Daily limit reached (100 messages). Come back tomorrow.";
    return { ok: false, minuteUsed, dayUsed, reason };
  }

  return { ok: true, minuteUsed, dayUsed };
}
