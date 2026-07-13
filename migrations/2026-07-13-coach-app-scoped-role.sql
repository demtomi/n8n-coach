-- Scoped credential for the public coach endpoint (sw-advisors fix 5).
--
-- The problem: the coach — public, unauthenticated, internet-facing — holds the SHARED
-- project's `service_role` secret key (the one named `claudecode`, the same value root
-- .env carries). That key bypasses RLS on every table in the project, including the CRM
-- (`prospects`, `agents`, ...). A leak of the app's Vercel env is a leak of the business.
--
-- The intended fix was a dedicated Supabase project. Supabase caps free projects at 2 PER
-- USER (not per org), and both slots are load-bearing (dts-projects, upwork-copilot), so
-- that path costs ~USD 25/mo for a portfolio demo. This achieves the same credential
-- isolation for free: a Postgres role that can do NOTHING but call the coach's three
-- functions, and a secret key bound to that role via `secret_jwt_template`.
--
-- What this does NOT fix: the coach and the CRM still share Postgres compute. The spend
-- ceiling + rate limiter bound that; an own-project would eliminate it. Logged as residual.
--
-- Additive and reversible. Touches no CRM object.

-- 1. The role. NOLOGIN: it is only ever reached by PostgREST doing SET ROLE from a JWT.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'coach_app') then
    create role coach_app nologin;
  end if;
end
$$;

-- PostgREST authenticates as `authenticator` and switches to the JWT's `role` claim.
-- Without this grant the switch fails and every request 500s.
grant coach_app to authenticator;

-- Needed to resolve `public.coach_*` at all. Schema usage only — no table rights follow.
grant usage on schema public to coach_app;

-- 2. coach_match_documents becomes SECURITY DEFINER.
--
-- It is currently INVOKER, which means RLS on coach_documents is what stops a caller from
-- reading through it. coach_app has (and must keep) zero table grants, so as INVOKER it
-- would return nothing. Making it DEFINER lets the corpus read happen without ever handing
-- coach_app a table privilege.
--
-- The trap this opens: a SECURITY DEFINER function keeps Postgres's default EXECUTE-to-
-- PUBLIC grant, which would let the anon (publishable) key call it and read straight
-- through RLS. The revoke below is not optional — it is what keeps this change from being
-- a downgrade. search_path is pinned so the definer body cannot be hijacked.
create or replace function public.coach_match_documents(
  query_embedding vector,
  match_count integer default 5
)
returns table(
  id text, title text, category text, docs_url text,
  github_url text, content text, similarity double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    d.id, d.title, d.category, d.docs_url, d.github_url, d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from coach_documents d
  where d.embedding is not null
  order by d.embedding <=> query_embedding
  limit match_count;
$function$;

-- 3. Lock the three live functions down to coach_app + service_role, nobody else.
-- (coach_check_and_reserve / coach_settle_usage were already revoked from public in the
--  spend-ceiling migration; repeated here so this file is the whole truth of the grants.)
revoke all on function public.coach_match_documents(vector, integer)
  from public, anon, authenticated;
revoke all on function public.coach_check_and_reserve(text, numeric, numeric)
  from public, anon, authenticated;
revoke all on function public.coach_settle_usage(numeric, bigint, bigint, bigint, bigint, numeric)
  from public, anon, authenticated;

grant execute on function public.coach_match_documents(vector, integer) to coach_app;
grant execute on function public.coach_check_and_reserve(text, numeric, numeric) to coach_app;
grant execute on function public.coach_settle_usage(numeric, bigint, bigint, bigint, bigint, numeric) to coach_app;

-- 4. Belt and braces. coach_app gets no table rights now and inherits none later:
-- default privileges in this schema would otherwise hand it rights on tables created after
-- this migration. RLS is enabled with zero policies on every coach_* table, so even a
-- future accidental grant denies — but do not rely on a second line of defence alone.
revoke all on all tables in schema public from coach_app;
revoke all on all sequences in schema public from coach_app;
alter default privileges in schema public revoke all on tables from coach_app;
alter default privileges in schema public revoke all on sequences from coach_app;

-- 5. The legacy superseded functions are NOT granted to coach_app. They stay as the
-- service_role-only rollback path from the spend-ceiling migration.
--   coach_check_rate_limit(text), coach_check_budget(numeric), coach_record_usage(...)
