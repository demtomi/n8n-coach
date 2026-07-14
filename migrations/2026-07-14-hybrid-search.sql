-- B3 — hybrid retrieval: BM25-style lexical search fused with the vector search.
--
-- WHY. Recall@5 is 0.80 against a 0.85 exit gate, and the misses are not subtle. The rows
-- that fail are the ones where the query names a thing EXACTLY -- "Code node", "Merge node",
-- "$today" -- and a pure embedding search returns things that are merely about the same
-- topic. Lexical search is very good at exactly this and very bad at paraphrase; vectors are
-- the reverse. Fusing them is the standard answer, and it is the last cheap lever before the
-- corpus itself has to change again.
--
-- HOW: Reciprocal Rank Fusion, not a weighted score blend. Cosine distance and ts_rank_cd
-- live on different, non-comparable scales, and their ranges shift per query -- any fixed
-- alpha over the raw scores is a calibration that silently rots. RRF throws the scores away
-- and fuses RANKS: a doc's contribution is 1/(k + rank) from each retriever it appears in.
-- It needs no calibration and cannot be broken by one retriever's scores drifting.
--
-- The weights (w_vec / w_lex) still let us lean on one retriever, but they act on rank
-- contributions, which are bounded and comparable by construction.

-- 1. The lexical index. Generated, so it can never drift from the content it indexes -- a
--    trigger-maintained column would go stale on any write path that forgot the trigger.
alter table coach_documents
  add column if not exists tsv tsvector
  generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) stored;

create index if not exists coach_documents_tsv_idx on coach_documents using gin (tsv);

-- 2. The fused search.
--
-- similarity IS STILL THE TRUE COSINE for every row, whichever retriever surfaced it. That
-- is load-bearing: the off-topic gate in app/api/chat/route.ts refuses anything whose top
-- result scores below OFF_TOPIC_SIM_THRESHOLD, so if this function returned a fused score
-- in that field, the gate would be reading a number that no longer means what it thinks it
-- means, and a legitimate question could be refused (or an off-topic one let through) with
-- nothing in the code looking wrong.
--
-- SECURITY DEFINER + revoke-from-PUBLIC, for the same reason as coach_match_documents: a
-- DEFINER function left open to PUBLIC hands the anon key a read straight through RLS.
create or replace function public.coach_hybrid_match(
  query_text text,
  query_embedding vector,
  match_count integer default 50,
  w_vec double precision default 1.0,
  w_lex double precision default 1.0,
  rrf_k integer default 60
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
  with q as (
    select websearch_to_tsquery('english', query_text) as tsq
  ),
  vec as (
    select d.id, row_number() over (order by d.embedding <=> query_embedding) as rank
    from coach_documents d
    where d.embedding is not null
    order by d.embedding <=> query_embedding
    limit match_count
  ),
  lex as (
    select d.id, row_number() over (order by ts_rank_cd(d.tsv, q.tsq) desc) as rank
    from coach_documents d, q
    -- An empty tsquery (a query of pure stopwords) matches nothing rather than everything.
    where q.tsq is not null and d.tsv @@ q.tsq
    order by ts_rank_cd(d.tsv, q.tsq) desc
    limit match_count
  ),
  fused as (
    select
      coalesce(v.id, l.id) as id,
      w_vec * coalesce(1.0 / (rrf_k + v.rank), 0.0)
        + w_lex * coalesce(1.0 / (rrf_k + l.rank), 0.0) as score
    from vec v
    full outer join lex l on l.id = v.id
  )
  select
    d.id, d.title, d.category, d.docs_url, d.github_url, d.content,
    1 - (d.embedding <=> query_embedding) as similarity
  from fused f
  join coach_documents d on d.id = f.id
  order by f.score desc, d.id
  limit match_count;
$function$;

revoke all on function public.coach_hybrid_match(text, vector, integer, double precision, double precision, integer)
  from public, anon, authenticated;

grant execute on function public.coach_hybrid_match(text, vector, integer, double precision, double precision, integer)
  to coach_app;
