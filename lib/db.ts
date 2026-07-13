import postgres from "postgres";
import { SUPABASE_ROOT_CA } from "./supabase-ca";

/**
 * The coach's database handle.
 *
 * This app is public and unauthenticated. It used to reach Postgres through supabase-js
 * carrying the SHARED project's `service_role` secret key — a credential that bypasses RLS
 * on every table in the project, the CRM included. A leak of this app's env was a leak of
 * the business.
 *
 * It now connects as `coach_app`, a Postgres role holding EXECUTE on exactly three
 * functions and no table privileges at all. The scope is enforced by Postgres, not by us
 * remembering to be careful: as this role, `select * from prospects` is
 * `permission denied for table prospects`, and so is `select * from coach_documents`.
 * The three functions are SECURITY DEFINER, which is how the corpus read happens without
 * the role ever holding a table grant.
 *
 * (The intended fix was a dedicated Supabase project. Supabase caps free projects at 2 per
 * USER, both slots are load-bearing, and custom-role API keys are Pro-gated — so the free
 * route to the same isolation is native Postgres auth. See
 * migrations/2026-07-13-coach-app-scoped-role.sql.)
 */

let _sql: postgres.Sql | null = null;

/**
 * On TLS: Supabase's pooler presents its own PKI (`Supabase Root 2021 CA`), not a
 * publicly-trusted chain, so `ssl: "verify-full"` against the system trust store fails
 * outright.
 *
 * The tempting shortcut is `ssl: "require"`. Do not: postgres.js maps 'require' (and
 * 'allow' and 'prefer') to `rejectUnauthorized: false`, which accepts ANY certificate. That
 * is strictly weaker than the cert-verified HTTPS that supabase-js used to give us — an
 * on-path attacker could take the coach_app password and forge gate responses (allowed=true
 * defeats the spend ceiling). We pin Supabase's root instead.
 */
export function db(): postgres.Sql {
  if (!_sql) {
    const url = process.env.COACH_DATABASE_URL;
    if (!url) {
      // Fail loudly at first use, not silently at module load — the gate that reads this
      // handle fails closed, and a missing URL must reach that path as an error.
      throw new Error("COACH_DATABASE_URL is not set");
    }
    _sql = postgres(url, {
      ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true },
      // Supavisor in transaction mode hands a different backend to each transaction, so a
      // named prepared statement from one request is not there for the next.
      prepare: false,
      // Vercel runs several concurrent invocations on one instance, so a single connection
      // would make request B's retrieval queue behind request A's gate. The pooler does the
      // real pooling; this is just enough sockets to not self-serialize.
      max: 4,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return _sql;
}

/**
 * Numerics and bigints go over the wire as strings with an explicit cast.
 *
 * postgres.js infers a JS number as int8 or float8 depending on its value, which makes
 * function overload resolution depend on the data. `300` would bind int8 and `2.5` float8
 * against the same `numeric` parameter. Sending text and casting is deterministic.
 */
export const num = (n: number): string => String(n);
