-- Goodreads hardening (security assessment of PR #269, findings F2, F3 and F16).
--
-- F3. `goodreads_title_ratings` was readable by every member, and its key is
-- "<normalised title>|<surnames>" of whatever Book a member opened, a private Manual
-- book included: the title of a Manual book is private to its owner. Nothing reads
-- the table but the goodreads-rating edge function (service role); the Library's
-- `goodreads_rating(books)` reads `goodreads_ratings` only (by ISBN-13). So members
-- lose the select grant and the policy. The rows already there cannot be told apart
-- from rows of Manual titles, so the table is emptied; it refills on demand (the
-- function asks Goodreads again, one title at a time) and the web app no longer asks by
-- title for a Manual book.
--
-- F2. The function stored a rating found by a title search under the ISBN it was
-- asked about, so a member could pin any rating onto any ISBN for 30 days. The
-- function now stores a title-search answer under its title key only. The rows
-- the old code wrote (`matched_by = 'title'` in the ISBN table) are removed and the
-- table refuses them from now on: an ISBN row is a fact about the ISBN.
--
-- F16. A per-member counter for the two edge functions that spend an upstream budget
-- on behalf of any member (goodreads-rating, enrich): `edge_rate_hit` counts one call
-- in a fixed window and says whether it is still within the limit. Service role only;
-- members cannot read or write the counters.

-- ------------------------------------------------------------------------ F3

drop policy goodreads_title_ratings_readable on public.goodreads_title_ratings;
revoke select on public.goodreads_title_ratings from authenticated;
revoke all on public.goodreads_title_ratings from anon, authenticated;

truncate table public.goodreads_title_ratings;

-- ------------------------------------------------------------------------ F2

delete from public.goodreads_ratings where matched_by = 'title';

alter table public.goodreads_ratings drop constraint goodreads_ratings_matched_by;
alter table public.goodreads_ratings
  add constraint goodreads_ratings_matched_by check (matched_by = 'isbn');

comment on column public.goodreads_ratings.matched_by is
  'Always ''isbn'' (or null for a miss): a rating found by title lives in goodreads_title_ratings, '
  'never under an ISBN a caller named.';

-- ----------------------------------------------------------------------- F16

create table public.edge_rate_limits (
  member_id    uuid not null references auth.users (id) on delete cascade,
  -- What is limited: 'goodreads-rating', 'enrich'.
  bucket       text not null,
  window_start timestamptz not null default now(),
  hits         integer not null default 0,
  primary key (member_id, bucket),
  constraint edge_rate_limits_bucket_format check (bucket ~ '^[a-z][a-z-]{0,39}$')
);

comment on table public.edge_rate_limits is
  'Calls per member and edge function in the current window (see edge_rate_hit). Service role only.';

alter table public.edge_rate_limits enable row level security;
revoke all on public.edge_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on public.edge_rate_limits to service_role;

-- Counts one call of a member in a bucket and says whether it is within the limit
-- (true) or over it (false). A fixed window: the first call opens it, it restarts when
-- p_window_seconds have passed. One statement, so concurrent calls count one by one.
create function public.edge_rate_hit(p_member uuid, p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language sql
volatile
set search_path = pg_catalog, public
as $$
  with hit as (
    insert into public.edge_rate_limits as r (member_id, bucket, window_start, hits)
    values (p_member, p_bucket, now(), 1)
    on conflict (member_id, bucket) do update
      set window_start = case
            when r.window_start <= now() - make_interval(secs => p_window_seconds) then now()
            else r.window_start
          end,
          hits = case
            when r.window_start <= now() - make_interval(secs => p_window_seconds) then 1
            else r.hits + 1
          end
    returning r.hits
  )
  select hits <= p_limit from hit
$$;

revoke all on function public.edge_rate_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.edge_rate_hit(uuid, text, integer, integer) to service_role;

-- --------------------------------------------------------------------- I2

-- The two security-definer functions of the Catalogue search pin `pg_catalog, public` as their
-- search path; `pg_temp` is searched first when it is not named, and naming it last keeps a
-- temp table or function of the caller from ever shadowing a name. Tested before this: it had
-- no effect (assessment 1.5). Only the setting changes, never a body (ALTER FUNCTION), so the
-- visibility rule of `search_books` stays word for word what 20261020020000 wrote.
alter function public.search_books(text, integer) set search_path = pg_catalog, public, pg_temp;
alter function private.book_search_sync() set search_path = pg_catalog, public, pg_temp;
