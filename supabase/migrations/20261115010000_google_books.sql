-- Google Books as the app's last book source (issue #305): the `google-books` edge function
-- (supabase/functions/google-books) asks the Google Books API with a key only it holds and keeps what it learns
-- here, for a short time. Everything below is additive; nothing existing is changed but two allow-lists.
--
-- 1. `google_books_cache`   what Google said to a question (an ISBN, a title and author, free words), until it expires.
--                           Google's terms allow no permanent copy and no cached copy "longer than permitted by the
--                           cache header", so every row has an `expires_at` and the table refuses one that lives
--                           longer than a day; the function never answers an expired row and the cron job below
--                           deletes it. Never a description: the function does not ask for one.
--                           Service role only, like `edge_pace` and `edge_rate_limits`, and NOT readable by members:
--                           the key of a free-text row is whatever a member typed in Search.
-- 2. `google_books_budget`  one row a day and scope: the requests the function has made to Google that day ('all'), and
--                           the slice `enrich` has spent ('enrich'); and `google_books_budget_take(limit, scope,
--                           scope_limit)` counts one request against both (or neither) and says whether there is room.
--                           The free quota is about 1,000 requests a day for the whole app; the function refuses
--                           (answers `unavailable`) beyond ~900 instead of burning the rest, and `enrich` (a slice of
--                           300 of them) cannot eat the members' and the imports' share. Counted by Google's day
--                           (Pacific time, when the quota resets). A member's own day is the rate bucket
--                           `google-books-day` (`edge_rate_hit`, 24 h): no table of its own.
-- 3. `private.purge_google_books()` deletes expired cache rows and old counters; pg_cron runs it hourly.
-- 4. `book_genres.source` may be `google`: a Catalogue Book that the other sources left without a genre gets the
--    genres Google's categories map to (data/enrich/genres.ts `googleGenres`).
-- 5. `private.cover_allowed` knows Google's cover host (`books.google.com/books/content?…`), so a Google edition's
--    cover can be linked on its Book; `private.cover_shown` is false for it (like Hardcover's: inside the app only).
--    The address is only ever LINKED: the cover cache (`/cover`) has its own allow-list, which this does not touch, and
--    6. below keeps the cover store from ever copying it (`private.cover_storable`).

-- ------------------------------------------------------------------------------------------------ 1. the cache

create table public.google_books_cache (
  -- `isbn:<isbn13>`, `title:<normalised title>|<first author>|<language>`, `q:<normalised words>|<language>`.
  cache_key   text primary key,
  status      text not null,
  -- The volumes as the function parsed them (googleBooksRecord.ts `GoogleVolume`): facts of the edition, the
  -- app's genres, the cover's address. Empty for a miss.
  volumes     jsonb not null default '[]',
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null,

  constraint google_books_cache_key_format check (
    char_length(cache_key) <= 400 and cache_key ~ '^(isbn:97[89][0-9]{10}|(title|q):.+)$'
  ),
  constraint google_books_cache_status check (status in ('found', 'not_found')),
  constraint google_books_cache_volumes_shape check (case when jsonb_typeof(volumes) = 'array' then jsonb_array_length(volumes) <= 20 else false end),
  constraint google_books_cache_found_has_volumes check ((status = 'found') = (volumes <> '[]'::jsonb)),
  -- The terms: nothing is kept longer than a day, whatever the function asks for.
  constraint google_books_cache_lifetime check (expires_at > fetched_at and expires_at <= fetched_at + interval '1 day')
);

comment on table public.google_books_cache is
  'Google Books answers by question (issue #305), kept until expires_at (at most a day: the Google APIs terms allow no permanent '
  'copy). Filled by the google-books edge function, purged hourly. Service role only: a free-text key is what a member typed.';

create index google_books_cache_expires on public.google_books_cache (expires_at);

alter table public.google_books_cache enable row level security;
revoke all on public.google_books_cache from public, anon, authenticated;
grant select, insert, update, delete on public.google_books_cache to service_role;

-- ----------------------------------------------------------------------------------------------- 2. the budget

create table public.google_books_budget (
  -- The day by Google's clock (Pacific time).
  day   date not null,
  -- 'all': every request of the day; any other word: a slice of it (`enrich`), counted in 'all' too.
  scope text not null default 'all',
  used  integer not null default 0,
  primary key (day, scope),
  constraint google_books_budget_scope check (scope ~ '^[a-z]{1,20}$'),
  constraint google_books_budget_used check (used >= 0)
);

comment on table public.google_books_budget is
  'Requests the google-books function made to Google on a (Pacific) day (issue #305), in total and per slice, against a daily budget of ~900. Service role only.';

alter table public.google_books_budget enable row level security;
revoke all on public.google_books_budget from public, anon, authenticated;
grant select, insert, update, delete on public.google_books_budget to service_role;

-- Counts one request of today against `p_limit` (the day, scope 'all') and, when `p_scope` names a slice, against
-- `p_scope_limit` too: true when both have room, false (and nothing counted) when either is spent. Each statement counts
-- one by one under the row lock; a slice taken and then refused by the day is given back. Refusal: budget_invalid (22023).
create function public.google_books_budget_take(p_limit integer, p_scope text default 'all', p_scope_limit integer default null)
returns boolean
language plpgsql
volatile
set search_path = pg_catalog, public
as $$
declare
  v_day   date := (now() at time zone 'America/Los_Angeles')::date;
  v_used  integer;
  v_slice boolean := p_scope is not null and p_scope <> 'all';
begin
  if p_limit is null or p_limit not between 1 and 100000
     or (v_slice and (p_scope !~ '^[a-z]{1,20}$' or p_scope_limit is null or p_scope_limit not between 1 and 100000)) then
    raise exception 'budget_invalid' using errcode = '22023';
  end if;
  if v_slice then
    insert into public.google_books_budget as b (day, scope, used) values (v_day, p_scope, 1)
    on conflict (day, scope) do update set used = b.used + 1 where b.used < p_scope_limit
    returning b.used into v_used;
    if v_used is null then return false; end if;
    v_used := null;
  end if;
  insert into public.google_books_budget as b (day, scope, used) values (v_day, 'all', 1)
  on conflict (day, scope) do update set used = b.used + 1 where b.used < p_limit
  returning b.used into v_used;
  if v_used is null then
    if v_slice then
      update public.google_books_budget set used = used - 1 where day = v_day and scope = p_scope;
    end if;
    return false;
  end if;
  return true;
end
$$;

revoke all on function public.google_books_budget_take(integer, text, integer) from public, anon, authenticated;
grant execute on function public.google_books_budget_take(integer, text, integer) to service_role;

-- --------------------------------------------------------------------------------------------------- 3. the purge

create function private.purge_google_books()
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_gone bigint;
begin
  -- An expired row is never answered; an hour's grace only keeps the purge out of the way of a lookup in flight.
  delete from public.google_books_cache where expires_at < now() - interval '1 hour';
  get diagnostics v_gone = row_count;
  -- A month of counters is plenty to see the day's use and the trend.
  delete from public.google_books_budget where day < (now() at time zone 'America/Los_Angeles')::date - 30;
  return v_gone;
end;
$$;

comment on function private.purge_google_books() is
  'Deletes the expired google_books_cache rows and the google_books_budget days older than 30 and answers how many cache rows went. Run hourly by pg_cron; not callable by members.';

revoke all on function private.purge_google_books() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
      begin
        create extension pg_cron;
      exception when others then
        raise notice 'pg_cron could not be enabled (%): private.purge_google_books() is not scheduled', sqlerrm;
      end;
    else
      raise notice 'pg_cron is not available here: private.purge_google_books() is not scheduled';
    end if;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      -- By name: scheduling again replaces the job instead of doubling it.
      perform cron.schedule('purge-google-books', '25 * * * *', 'select private.purge_google_books()');
    exception when others then
      raise notice 'pg_cron is there but the job could not be scheduled (%): private.purge_google_books() is not scheduled', sqlerrm;
    end;
  end if;
end;
$$;

-- ------------------------------------------------------------------------------------------------- 4. genres

alter table public.book_genres drop constraint book_genres_source;
alter table public.book_genres
  add constraint book_genres_source check (source in ('wikidata', 'apple', 'openlibrary', 'google'));

-- ------------------------------------------------------------------------------------------------- 5. covers

-- `cover_allowed` of 20261112010000, plus Google's cover address: https, the host exactly, the image path
-- `/books/content` with its query (not the host's other pages). LINKED only.
create or replace function private.cover_allowed(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|i\.gr-assets\.com|assets\.hardcover\.app|([a-z0-9-]+\.)+mzstatic\.com)(/|$)'
    or p_url ~* '^https://books\.google\.com/books/content\?',
    false)
$$;

-- `cover_shown` of 20261112010000, plus Google's: its covers are shown inside the app only, never on a reading page,
-- in a link preview, the feed or a profile (the Google Books terms ask for attribution next to what it shows, which a
-- public page has no place for). Same grants as before (`create or replace` keeps them).
create or replace function private.cover_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select private.cover_allowed(p_book.cover_url)
     and p_book.cover_url !~* '^https://assets\.hardcover\.app(/|$)'
     and p_book.cover_url !~* '^https://books\.google\.com/'
$$;

-- --------------------------------------------------------------------------------- 6. Google's covers are never stored

-- `cover_allowed` (above) is the hosts a cover may be LINKED from; `cover_storable` is the hosts the cover store may COPY
-- from: the same list without Google Books. Google's terms allow no permanent copy of what its API returns, so its covers
-- are linked and never fetched into the bucket: the queue (`cover_store_reconcile`) and the owner's status
-- (`owner_cover_status`) ask this, and the cover-store function has no rule for the host either (plan.ts).
create or replace function private.cover_storable(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select private.cover_allowed(p_url) and p_url !~* '^https://books\.google\.com/'
$$;

revoke all on function private.cover_storable(text) from public, anon, authenticated;
grant execute on function private.cover_storable(text) to service_role;

-- `private.cover_store_reconcile` of 20261108010000, whole; the change: `cover_storable` for `cover_allowed`.
create or replace function private.cover_store_reconcile()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into private.cover_store_queue (book_id, source_url)
  select b.id, b.cover_url
    from public.books b
   where b.cover_key is null
     and b.cover_url is not null
     and private.cover_storable(b.cover_url)
     and exists (select 1 from public.library_entries e where e.book_id = b.id)
     and not exists (select 1 from private.cover_store_queue q where q.book_id = b.id)
  on conflict (book_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- `public.owner_cover_status` of 20261108010000, whole; the change: `cover_storable` for `cover_allowed` in "unqueued" and "not_storable".
create or replace function public.owner_cover_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_with_cover integer;
  v_stored integer;
  v_failed integer;
  v_bytes bigint;
  v_warnings text[] := '{}';
  v_result jsonb;
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  select count(*), count(*) filter (where b.cover_key is not null)
    into v_with_cover, v_stored
    from public.books b
   where b.cover_url is not null
     and exists (select 1 from public.library_entries e where e.book_id = b.id);

  select count(*) into v_failed from private.cover_store_queue where state = 'failed';
  select coalesce(sum(bytes), 0)::bigint into v_bytes from private.cover_objects;

  if v_bytes > 5368709120::bigint then v_warnings := array_append(v_warnings, 'stored_bytes_over_5gb'); end if;
  if v_with_cover > 0 and v_failed * 20 > v_with_cover then v_warnings := array_append(v_warnings, 'failed_over_5_percent'); end if;

  select jsonb_build_object(
    'enabled', coalesce((select enabled from private.cover_store_settings where id), false),
    'with_cover', v_with_cover,
    'stored', v_stored,
    'queued', (select count(*) from private.cover_store_queue
                where state = 'queued' and coalesce(last_error, '') not in ('throttled', 'deleting')),
    'leased', (select count(*) from private.cover_store_queue where state = 'leased'),
    'throttled', (select count(*) from private.cover_store_queue
                   where state = 'queued' and last_error in ('throttled', 'deleting')),
    'failed', v_failed,
    'failed_by_reason', coalesce((select jsonb_object_agg(reason, n)
                                    from (select coalesce(last_error, 'unknown') as reason, count(*) as n
                                            from private.cover_store_queue where state = 'failed' group by 1) f), '{}'),
    'gone', (select count(*) from private.cover_store_queue where state = 'gone'),
    'unsupported', (select count(*) from private.cover_store_queue where state = 'unsupported'),
    -- Storable and not queued yet: the next tick's reconcile takes them.
    'unqueued', (select count(*) from public.books b
                  where b.cover_key is null and b.cover_url is not null and private.cover_storable(b.cover_url)
                    and exists (select 1 from public.library_entries e where e.book_id = b.id)
                    and not exists (select 1 from private.cover_store_queue q where q.book_id = b.id)),
    -- Other hosts: not stored in v1.
    'not_storable', (select count(*) from public.books b
                      where b.cover_url is not null and not private.cover_storable(b.cover_url)
                        and exists (select 1 from public.library_entries e where e.book_id = b.id)),
    'objects', (select count(*) from private.cover_objects),
    'bytes', v_bytes,
    'orphaned', (select count(*) from private.cover_objects where orphaned_at is not null),
    'deleting', (select count(*) from private.cover_objects where deleting_at is not null),
    'warnings', to_jsonb(v_warnings)
  ) into v_result;
  return v_result;
end
$$;
