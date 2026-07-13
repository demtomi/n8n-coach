-- Global daily spend ceiling for the public coach endpoint, as a RESERVATION.
--
-- Why a ceiling at all: per-IP rate limiting is not a cost control on an unauthenticated
-- public endpoint. "100/day per IP" multiplies by an unbounded supply of IPs, so the only
-- real bound on the Anthropic + Voyage bill is a global one. plan.md § T10 promised
-- "hard rate limit per IP + daily global cap"; only the per-IP half was ever built.
--
-- Why reserve-then-confirm rather than check-then-spend:
--   1. CONCURRENCY. A plain "read spend, compare to ceiling, then go" lets fifty
--      simultaneous requests all read the same under-ceiling total and all proceed.
--      The reservation is also the lock: the day row is locked FOR UPDATE, the estimate
--      is debited before the work starts, so the ceiling holds under concurrency.
--   2. ABORTS. If the client hangs up mid-stream, the settle call never runs. With a
--      reservation the estimate simply stays on the books, which is the safe direction.
--      With check-then-spend, an attacker who aborts every request costs real Anthropic
--      money that the ledger never records, and the ceiling never trips.
--
-- Additive only. Creates coach_* objects and touches nothing else in the shared project.

create table if not exists public.coach_daily_spend (
  day                date primary key,
  requests           integer not null default 0,
  input_tokens       bigint  not null default 0,
  output_tokens      bigint  not null default 0,
  cache_write_tokens bigint  not null default 0,
  cache_read_tokens  bigint  not null default 0,
  cost_cents         numeric(12, 4) not null default 0,  -- reserved + settled
  updated_at         timestamptz not null default now()
);

-- Supabase auto-grants all DML on new public tables to anon + authenticated.
-- Revoke it: this ledger is the thing that stops the bill, and nothing browser-facing
-- has any business writing to it.
revoke all on public.coach_daily_spend from anon, authenticated;
alter table public.coach_daily_spend enable row level security;

-- ONE round trip: per-IP rate limit + global ceiling + reservation, atomically.
-- Replaces two sequential RPCs on the path that decides time-to-first-token.
create or replace function public.coach_check_and_reserve(
  p_ip_hash       text,
  p_ceiling_cents numeric,
  p_reserve_cents numeric
)
returns table(
  allowed     boolean,
  reason      text,
  minute_used integer,
  day_used    integer,
  spend_cents numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute_limit int := 10;
  v_day_limit    int := 100;
  v_now   timestamptz := now();
  v_today date := (v_now at time zone 'utc')::date;
  v_minute_count int;
  v_minute_start timestamptz;
  v_day_count    int;
  v_day_start    timestamptz;
  v_spent numeric := 0;
begin
  -- Per-IP window (unchanged semantics from coach_check_rate_limit).
  insert into coach_rate_limits (ip_hash, minute_count, minute_start, day_count, day_start)
  values (p_ip_hash, 0, v_now, 0, v_now)
  on conflict (ip_hash) do nothing;

  select rl.minute_count, rl.minute_start, rl.day_count, rl.day_start
    into v_minute_count, v_minute_start, v_day_count, v_day_start
  from coach_rate_limits rl
  where rl.ip_hash = p_ip_hash
  for update;

  if v_now - v_minute_start > interval '1 minute' then
    v_minute_count := 0;
    v_minute_start := v_now;
  end if;

  if v_now - v_day_start > interval '1 day' then
    v_day_count := 0;
    v_day_start := v_now;
  end if;

  if v_minute_count >= v_minute_limit then
    update coach_rate_limits rl set
      minute_count = v_minute_count, minute_start = v_minute_start,
      day_count = v_day_count, day_start = v_day_start
    where rl.ip_hash = p_ip_hash;
    return query select false, 'rate_minute'::text, v_minute_count, v_day_count, 0::numeric;
    return;
  end if;

  if v_day_count >= v_day_limit then
    update coach_rate_limits rl set
      minute_count = v_minute_count, minute_start = v_minute_start,
      day_count = v_day_count, day_start = v_day_start
    where rl.ip_hash = p_ip_hash;
    return query select false, 'rate_day'::text, v_minute_count, v_day_count, 0::numeric;
    return;
  end if;

  -- Global ceiling. Lock the day row so concurrent callers serialize here: this is
  -- what makes the ceiling an actual bound and not a suggestion.
  insert into coach_daily_spend (day) values (v_today)
  on conflict (day) do nothing;

  select ds.cost_cents into v_spent
  from coach_daily_spend ds
  where ds.day = v_today
  for update;

  v_spent := coalesce(v_spent, 0);

  if v_spent >= p_ceiling_cents then
    return query select false, 'budget'::text, v_minute_count, v_day_count, v_spent;
    return;
  end if;

  -- Allowed. Debit the estimate NOW and count the request.
  update coach_daily_spend ds set
    cost_cents = ds.cost_cents + p_reserve_cents,
    requests   = ds.requests + 1,
    updated_at = now()
  where ds.day = v_today;

  update coach_rate_limits rl set
    minute_count = v_minute_count + 1, minute_start = v_minute_start,
    day_count    = v_day_count + 1,    day_start    = v_day_start
  where rl.ip_hash = p_ip_hash;

  return query select true, 'ok'::text, v_minute_count + 1, v_day_count + 1, v_spent + p_reserve_cents;
end;
$$;

-- Reconcile the reservation against what the turn actually cost.
-- delta may be negative (we over-reserved), which refunds the difference.
create or replace function public.coach_settle_usage(
  p_reserved_cents     numeric,
  p_input_tokens       bigint,
  p_output_tokens      bigint,
  p_cache_write_tokens bigint,
  p_cache_read_tokens  bigint,
  p_actual_cents       numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  update coach_daily_spend ds set
    input_tokens       = ds.input_tokens + p_input_tokens,
    output_tokens      = ds.output_tokens + p_output_tokens,
    cache_write_tokens = ds.cache_write_tokens + p_cache_write_tokens,
    cache_read_tokens  = ds.cache_read_tokens + p_cache_read_tokens,
    -- swap the estimate for the truth; never let the ledger go negative
    cost_cents         = greatest(ds.cost_cents - p_reserved_cents + p_actual_cents, 0),
    updated_at         = now()
  where ds.day = v_today;
end;
$$;

revoke all on function public.coach_check_and_reserve(text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.coach_settle_usage(numeric, bigint, bigint, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function public.coach_check_and_reserve(text, numeric, numeric) to service_role;
grant execute on function public.coach_settle_usage(numeric, bigint, bigint, bigint, bigint, numeric) to service_role;

-- Superseded by coach_check_and_reserve (kept for one deploy as a rollback path).
-- drop function if exists public.coach_check_budget(numeric);
-- drop function if exists public.coach_record_usage(bigint, bigint, bigint, bigint, numeric);
