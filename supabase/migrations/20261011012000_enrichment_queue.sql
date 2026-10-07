-- When enrichment runs, and how the `enrich` edge function stores what it found
-- (issues #166, #167, #168).
--
-- A Book that enters the Catalogue (add_to_library, the imports, Change
-- edition, anything that inserts a Catalogue row into `books`) is queued in
-- `private.enrich_queue` by a trigger; the member's write never waits for
-- enrichment and never fails because of it (the trigger turns every error into
-- a warning). The queue is drained by the `enrich` edge function:
--
--   the trigger (and pg_cron's 'enrich-drain', every ten minutes)
--     → private.enrich_kick()          at most one call in two minutes, only when work is due
--     → pg_net → POST <function_url>   {"action": "drain"}, Bearer <Vault enrich_token>
--     → enrich: enrich_claim(n) → Wikidata, Open Library, Apple → enrich_save(payload)
--
-- Where the function cannot be called (the local stack, CI, no URL or token
-- configured) nothing is sent and nothing fails: the queue simply waits, and
-- `supabase/functions/enrich/backfill.ts` drains it from a terminal.
--
-- Also here:
--   enrich_backfill(p_limit)   queues every Catalogue Book never enriched (the one-off
--                              backfill; resumable: run it again, it queues what is left)
--   enrich_refresh(p_limit)    queues Books enriched more than 30 days ago (pg_cron
--                              'enrich-refresh', daily)
--   enrich_stale_authors(n)    authors of Library Books whose facts are older than 30 days
--   enrich_save(payload)       stores one result in one transaction
--   enrich_failed(book, error) gives a claimed Book back with a growing delay
--   enrich_save_genres(…)      stores genres recomputed from kept signals (a new mapping version)
--
-- All of them are for the service role only (the function); members never call
-- them. `book_enrichment` (what was found for a Book, and when) is readable by
-- every member, so the app can tell "not enriched yet" from "nothing known".
--
-- The function's address and secret, once, by the owner (docs/ENRICHMENT.md):
--
--   update private.enrich_settings set function_url = 'https://<ref>.supabase.co/functions/v1/enrich';
--   select vault.create_secret('<the ENRICH_TOKEN function secret>', 'enrich_token');

create schema if not exists private;

-- --------------------------------------------------------- book_enrichment

create table public.book_enrichment (
  book_id      uuid primary key references public.books on delete cascade,
  -- 'enriched': a work or genres were found; 'not_found': every source answered
  -- and none knew the Book; 'failed': the sources kept failing (given up after
  -- six attempts; the daily refresh tries again after 30 days).
  status       text not null,
  -- Which sources contributed: 'wikidata', 'openlibrary', 'apple'.
  sources      text[] not null default '{}',
  -- The raw genre signals ({source, value, id?}[]), kept so a new mapping
  -- version is applied without asking any source again.
  signals      jsonb not null default '[]',
  map_version  integer,
  enriched_at  timestamptz not null default now(),

  constraint book_enrichment_status check (status in ('enriched', 'not_found', 'failed')),
  constraint book_enrichment_signals_array check (jsonb_typeof(signals) = 'array')
);

comment on table public.book_enrichment is
  'Issues #167/#168: what the enrich edge function found for a Catalogue Book and when, with the raw '
  'genre signals. Readable by every member, written only by the service role.';

create index book_enrichment_enriched_at on public.book_enrichment (enriched_at);

alter table public.book_enrichment enable row level security;
revoke all on public.book_enrichment from anon, authenticated;
grant select on public.book_enrichment to authenticated;
grant select, insert, update, delete on public.book_enrichment to service_role;

create policy book_enrichment_readable on public.book_enrichment
  for select to authenticated
  using (exists (select 1 from public.books b where b.id = book_id));

-- --------------------------------------------------------------- the queue

create table private.enrich_queue (
  book_id        uuid primary key references public.books on delete cascade,
  -- 'new' (entered the Catalogue), 'backfill', 'refresh', 'member' (asked for by
  -- a member); new and member go first.
  reason         text not null,
  enqueued_at    timestamptz not null default now(),
  -- Not before this (a failed attempt waits longer each time).
  not_before     timestamptz not null default now(),
  attempts       integer not null default 0,
  -- Claimed by a running function until then; a crashed run's claim lapses.
  claimed_until  timestamptz,
  last_error     text,

  constraint enrich_queue_reason check (reason in ('new', 'backfill', 'refresh', 'member'))
);

comment on table private.enrich_queue is
  'Issues #167/#168: Catalogue Books waiting for the enrich edge function. Filled by the books trigger, '
  'enrich_backfill and enrich_refresh; drained by enrich_claim / enrich_save / enrich_failed.';

create index enrich_queue_due on private.enrich_queue (not_before);

revoke all on private.enrich_queue from public, anon, authenticated;

create table private.enrich_settings (
  id              boolean primary key default true check (id),
  -- The function's address; null = off (nothing is sent; the queue waits).
  function_url    text check (function_url ~ '^https?://'),
  -- Longer than a drain runs (90 s), so two drains rarely overlap and the
  -- sources see one polite client, not two.
  min_interval    interval not null default interval '2 minutes',
  last_kick_at    timestamptz,
  last_request_id bigint
);

comment on table private.enrich_settings is
  'Issues #167/#168: where the enrich edge function is (null = off) and when it was last called. '
  'One row. Its token is the Vault secret enrich_token.';

insert into private.enrich_settings default values;
revoke all on private.enrich_settings from public, anon, authenticated;

-- ------------------------------------------------------------------ the kick

-- Calls the function to drain the queue, when there is something due, the
-- function can be called here, and the last call is at least `min_interval`
-- ago. Answers what it did: 'off', 'idle', 'debounced', 'unavailable' or 'sent'.
create function private.enrich_kick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.enrich_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.enrich_settings where id;
  if v_settings.function_url is null then
    return 'off';
  end if;
  if not exists (select 1 from private.enrich_queue
                  where not_before <= now() and (claimed_until is null or claimed_until < now())) then
    return 'idle';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'enrich_token';
  if nullif(btrim(v_token), '') is null then
    return 'unavailable';
  end if;

  update private.enrich_settings
     set last_kick_at = now()
   where id and coalesce(last_kick_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  -- pg_net waits in the background, never in this transaction: long enough for a whole drain.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'drain'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token),
                             'Content-Type', 'application/json');
  update private.enrich_settings set last_request_id = v_request where id;
  return 'sent';
end;
$$;

-- A Catalogue Book was inserted: queue it, and call the function if it is time.
create function private.enrich_on_book()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into private.enrich_queue (book_id, reason) values (new.id, 'new')
    on conflict (book_id) do nothing;
    perform private.enrich_kick();
  exception when others then
    raise warning 'enrichment not queued: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.enrich_kick() from public, anon, authenticated;
revoke all on function private.enrich_on_book() from public, anon, authenticated;

create trigger books_enrich
  after insert on public.books
  for each row
  when (new.owner_id is null)
  execute function private.enrich_on_book();

-- ---------------------------------------------------- the function's side

-- Claims up to p_limit due Books for p_lease, new and member-asked ones first;
-- with p_book, that Book only (a member's request, enriched at once).
create function public.enrich_claim(p_limit integer default 8, p_lease interval default interval '5 minutes',
                                    p_book uuid default null)
returns setof public.books
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with due as (
    select q.book_id
      from private.enrich_queue q
     where q.not_before <= now()
       and (q.claimed_until is null or q.claimed_until < now())
       and (p_book is null or q.book_id = p_book)
     order by case q.reason when 'member' then 0 when 'new' then 1 when 'backfill' then 2 else 3 end,
              q.enqueued_at
     limit greatest(1, least(coalesce(p_limit, 8), 100))
     for update skip locked
  ),
  claimed as (
    update private.enrich_queue q
       set claimed_until = now() + p_lease, attempts = q.attempts + 1
      from due
     where q.book_id = due.book_id
    returning q.book_id
  )
  select b.* from public.books b join claimed c on c.book_id = b.id;
end;
$$;

-- A claimed Book could not be enriched (a source failed): back into the queue,
-- after 10 minutes, then 20, 40, … at most a day; given up after six attempts
-- (recorded as 'failed', which the refresh tries again after 30 days).
create function public.enrich_failed(p_book uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_attempts integer;
begin
  update private.enrich_queue
     set claimed_until = null,
         last_error = left(p_error, 500),
         not_before = now() + least(interval '10 minutes' * power(2, greatest(attempts - 1, 0)), interval '1 day')
   where book_id = p_book
  returning attempts into v_attempts;
  if v_attempts >= 6 then
    delete from private.enrich_queue where book_id = p_book;
    insert into public.book_enrichment (book_id, status, enriched_at)
    values (p_book, 'failed', now())
    on conflict (book_id) do update set status = 'failed', enriched_at = now()
     where public.book_enrichment.status <> 'enriched';
  end if;
end;
$$;

-- Queues every Catalogue Book that was never enriched and is not queued yet;
-- at most p_limit (null = all). Answers how many. Run again to continue.
create function public.enrich_backfill(p_limit integer default null)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  with queued as (
    insert into private.enrich_queue (book_id, reason)
    select b.id, 'backfill'
      from public.books b
     where b.owner_id is null
       and not exists (select 1 from public.book_enrichment be where be.book_id = b.id)
       and not exists (select 1 from private.enrich_queue q where q.book_id = b.id)
     order by b.created_at
     limit p_limit
    on conflict (book_id) do nothing
    returning 1
  )
  select count(*)::integer from queued
$$;

-- Queues Books enriched more than 30 days ago, oldest first, at most p_limit.
create function public.enrich_refresh(p_limit integer default 100)
returns integer
language sql
security definer
set search_path = pg_catalog, public
as $$
  with queued as (
    insert into private.enrich_queue (book_id, reason)
    select be.book_id, 'refresh'
      from public.book_enrichment be
     where be.enriched_at < now() - interval '30 days'
       and not exists (select 1 from private.enrich_queue q where q.book_id = be.book_id)
     order by be.enriched_at
     limit greatest(0, coalesce(p_limit, 100))
    on conflict (book_id) do nothing
    returning 1
  )
  select count(*)::integer from queued
$$;

-- Authors of Books in somebody's Library whose facts are missing or older
-- than 30 days, oldest first: the function refreshes them after the Books.
create function public.enrich_stale_authors(p_limit integer default 5)
returns setof public.authors
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select a.*
    from public.authors a
   where (a.fetched_at is null or a.fetched_at < now() - interval '30 days'
          or a.works_fetched_at is null)
     and (a.wikidata_id is not null or a.openlibrary_key is not null)
     and exists (select 1 from public.book_authors ba
                   join public.library_entries e on e.book_id = ba.book_id
                  where ba.author_id = a.id)
   order by a.fetched_at nulls first, a.created_at
   limit greatest(0, least(coalesce(p_limit, 5), 100))
$$;

-- --------------------------------------------------------------- storing

-- An author by its keys: the row with its Wikidata item, else its Open Library
-- id, else (no row has either) a name-only row of that name, which is then
-- given the keys. Fields given replace the stored ones; fields not given are
-- kept (a stub from a work's credits never erases a fetched author).
create function private.enrich_author(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wd text := nullif(p ->> 'wikidata', '');
  v_ol text := nullif(p ->> 'openlibrary', '');
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_id uuid;
begin
  if v_wd is not null then
    select id into v_id from public.authors where wikidata_id = v_wd;
  end if;
  if v_id is null and v_ol is not null then
    select id into v_id from public.authors where openlibrary_key = v_ol;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from public.authors
     where lower(name) = lower(v_name) and wikidata_id is null and openlibrary_key is null;
  end if;

  if v_id is null then
    if v_name is null then
      return null;
    end if;
    insert into public.authors (wikidata_id, openlibrary_key, name)
    values (v_wd, v_ol, v_name)
    returning id into v_id;
  end if;

  update public.authors a
     set wikidata_id = coalesce(a.wikidata_id,
                                case when not exists (select 1 from public.authors o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(a.openlibrary_key,
                                    case when not exists (select 1 from public.authors o where o.openlibrary_key = v_ol) then v_ol end),
         name = case when p ? 'fetched' then coalesce(v_name, a.name) else a.name end,
         birth_date = case when p ? 'birthDate' then (p ->> 'birthDate')::date else a.birth_date end,
         birth_precision = case when p ? 'birthDate' then (p ->> 'birthPrecision')::smallint else a.birth_precision end,
         death_date = case when p ? 'deathDate' then (p ->> 'deathDate')::date else a.death_date end,
         death_precision = case when p ? 'deathDate' then (p ->> 'deathPrecision')::smallint else a.death_precision end,
         photo_url = case when p ? 'photoUrl' then p ->> 'photoUrl' else a.photo_url end,
         photo_credit = case when p ? 'photoUrl' then p -> 'photoCredit' else a.photo_credit end,
         summaries = case when p ? 'summaries' then coalesce(p -> 'summaries', '{}') else a.summaries end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else a.fetched_at end,
         works_fetched_at = case when (p ->> 'worksFetched')::boolean then now() else a.works_fetched_at end
   where a.id = v_id;
  return v_id;
end;
$$;

-- A series by its keys (Wikidata item, Open Library series id, else its name
-- among the name-only series); created if missing. Its parent, when given.
create function private.enrich_series(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wd text := nullif(p ->> 'wikidata', '');
  v_ol text := nullif(p ->> 'openlibrary', '');
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_id uuid;
  v_parent uuid;
begin
  if v_wd is not null then
    select id into v_id from public.series where wikidata_id = v_wd;
  end if;
  if v_id is null and v_ol is not null then
    select id into v_id from public.series where openlibrary_key = v_ol;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from public.series
     where lower(name) = lower(v_name) and wikidata_id is null and openlibrary_key is null and created_by is null;
  end if;
  if v_id is null then
    if v_name is null then
      return null;
    end if;
    insert into public.series (name, wikidata_id, openlibrary_key, source)
    values (v_name, v_wd, v_ol, case when v_wd is not null then 'wikidata' else 'openlibrary' end)
    returning id into v_id;
  end if;

  if jsonb_typeof(p -> 'parent') = 'object' then
    v_parent := private.enrich_series(p -> 'parent');
  end if;

  update public.series s
     set wikidata_id = coalesce(s.wikidata_id,
                                case when not exists (select 1 from public.series o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(s.openlibrary_key,
                                    case when not exists (select 1 from public.series o where o.openlibrary_key = v_ol) then v_ol end),
         source = case when v_wd is not null then 'wikidata' else s.source end,
         name = case when v_wd is not null and v_name is not null then v_name else s.name end,
         parent_id = case when v_parent is not null and v_parent <> s.id then v_parent else s.parent_id end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else s.fetched_at end
   where s.id = v_id;
  return v_id;
end;
$$;

-- A work by its keys (Wikidata item, else Open Library work key), created if
-- missing; given fields replace stored ones. Its authors and series places,
-- when given, are added (never removed: another source may know more).
create function private.enrich_work(p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wd text := nullif(p ->> 'wikidata', '');
  v_ol text := nullif(p ->> 'openlibrary', '');
  v_title text := nullif(btrim(p ->> 'title'), '');
  v_id uuid;
  v_other uuid;
  v_ref jsonb;
  v_n integer := 0;
  v_series uuid;
  v_author uuid;
begin
  if v_wd is not null then
    select id into v_id from public.works where wikidata_id = v_wd;
  end if;
  if v_ol is not null then
    select id into v_other from public.works where openlibrary_key = v_ol;
  end if;
  if v_id is null then
    v_id := v_other;
  end if;
  if v_id is null then
    if v_title is null or (v_wd is null and v_ol is null) then
      return null;
    end if;
    insert into public.works (wikidata_id, openlibrary_key, title)
    values (v_wd, v_ol, left(v_title, 500))
    returning id into v_id;
  end if;

  update public.works w
     set wikidata_id = coalesce(w.wikidata_id,
                                case when not exists (select 1 from public.works o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(w.openlibrary_key,
                                    case when v_other is null then v_ol end),
         title = coalesce(left(v_title, 500), w.title),
         titles = case when p ? 'titles' then w.titles || coalesce(p -> 'titles', '{}') else w.titles end,
         first_year = case when p ? 'year' then coalesce((p ->> 'year')::smallint, w.first_year) else w.first_year end,
         kind = case when p ? 'kind' then coalesce(p ->> 'kind', w.kind) else w.kind end,
         cover_url = case when p ? 'coverUrl' then coalesce(p ->> 'coverUrl', w.cover_url) else w.cover_url end,
         editions = case when p ? 'editions' then w.editions || coalesce(p -> 'editions', '{}') else w.editions end,
         genre_ids = case when jsonb_typeof(p -> 'genres') = 'array' and jsonb_array_length(p -> 'genres') > 0
                          then array(select jsonb_array_elements_text(p -> 'genres')) else w.genre_ids end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else w.fetched_at end
   where w.id = v_id;

  for v_ref in select * from jsonb_array_elements(coalesce(p -> 'authors', '[]')) loop
    v_n := v_n + 1;
    v_author := private.enrich_author(v_ref);
    if v_author is not null then
      insert into public.work_authors (work_id, author_id, position) values (v_id, v_author, v_n)
      on conflict (work_id, author_id) do nothing;
    end if;
  end loop;

  for v_ref in select * from jsonb_array_elements(coalesce(p -> 'series', '[]')) loop
    v_series := private.enrich_series(v_ref -> 'series');
    if v_series is not null then
      insert into public.work_series (work_id, series_id, position, source)
      values (v_id, v_series, round((v_ref ->> 'position')::numeric, 2), coalesce(v_ref ->> 'source', 'wikidata'))
      on conflict (work_id, series_id) do update
        set position = coalesce(excluded.position, public.work_series.position),
            source = case when excluded.position is not null then excluded.source else public.work_series.source end;
    end if;
  end loop;
  return v_id;
end;
$$;

revoke all on function private.enrich_author(jsonb) from public, anon, authenticated;
revoke all on function private.enrich_series(jsonb) from public, anon, authenticated;
revoke all on function private.enrich_work(jsonb) from public, anon, authenticated;

-- Stores one result of the function in one transaction:
--   {"authors": [author…], "series": [series…], "works": [work…],
--    "book": {"id", "work": {wikidata?, openlibrary?} | null, "matchedBy",
--             "authors": [{"position", "author": {…}}], "genres": [{"genre", "rank",
--             "source", "confidence"}], "mapVersion", "status", "sources", "signals"}}
-- Authors, series and works are upserted by their keys (private.enrich_*); the
-- Book's links, genres and enrichment row are replaced, and the Book leaves the
-- queue. Answers {"book": id, "work": id|null, "authors": [ids]}.
create function public.enrich_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_book jsonb := p_payload -> 'book';
  v_book_id uuid := (p_payload -> 'book' ->> 'id')::uuid;
  v_work uuid;
  v_author uuid;
  v_authors uuid[] := '{}';
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'authors', '[]')) loop
    v_author := private.enrich_author(v_item);
    if v_author is not null then
      v_authors := v_authors || v_author;
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'series', '[]')) loop
    perform private.enrich_series(v_item);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'works', '[]')) loop
    perform private.enrich_work(v_item);
  end loop;

  if v_book_id is null then
    return jsonb_build_object('authors', to_jsonb(v_authors));
  end if;
  if not exists (select 1 from public.books where id = v_book_id and owner_id is null) then
    delete from private.enrich_queue where book_id = v_book_id;
    return jsonb_build_object('book', null);
  end if;

  if jsonb_typeof(v_book -> 'work') = 'object' then
    v_work := private.enrich_work(v_book -> 'work');
  end if;
  delete from public.book_works where book_id = v_book_id;
  if v_work is not null then
    insert into public.book_works (book_id, work_id, matched_by)
    values (v_book_id, v_work, coalesce(v_book ->> 'matchedBy', 'openlibrary'));
  end if;

  v_authors := '{}';
  delete from public.book_authors where book_id = v_book_id;
  for v_item in select * from jsonb_array_elements(coalesce(v_book -> 'authors', '[]')) loop
    v_author := private.enrich_author(v_item -> 'author');
    if v_author is not null then
      insert into public.book_authors (book_id, position, author_id)
      values (v_book_id, (v_item ->> 'position')::smallint, v_author)
      on conflict (book_id, position) do nothing;
      v_authors := v_authors || v_author;
      if v_work is not null then
        insert into public.work_authors (work_id, author_id, position)
        values (v_work, v_author, (v_item ->> 'position')::smallint)
        on conflict (work_id, author_id) do nothing;
      end if;
    end if;
  end loop;

  if jsonb_typeof(v_book -> 'genres') = 'array' then
    delete from public.book_genres where book_id = v_book_id;
    insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
    select v_book_id, g ->> 'genre', (g ->> 'rank')::smallint, g ->> 'source', (g ->> 'confidence')::real,
           (v_book ->> 'mapVersion')::integer
      from jsonb_array_elements(v_book -> 'genres') g;
  end if;

  insert into public.book_enrichment (book_id, status, sources, signals, map_version, enriched_at)
  values (v_book_id,
          coalesce(v_book ->> 'status', 'enriched'),
          array(select jsonb_array_elements_text(coalesce(v_book -> 'sources', '[]'))),
          coalesce(v_book -> 'signals', '[]'),
          (v_book ->> 'mapVersion')::integer,
          now())
  on conflict (book_id) do update
    set status = excluded.status, sources = excluded.sources, signals = excluded.signals,
        map_version = excluded.map_version, enriched_at = excluded.enriched_at;

  delete from private.enrich_queue where book_id = v_book_id;
  return jsonb_build_object('book', v_book_id, 'work', v_work, 'authors', to_jsonb(v_authors));
end;
$$;

-- Genres recomputed from the kept signals by a newer mapping (`enrich` action
-- 'remap'): replaces the Book's computed genres, nothing else.
create function public.enrich_save_genres(p_book uuid, p_genres jsonb, p_map_version integer)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.book_genres where book_id = p_book;
  insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
  select p_book, g ->> 'genre', (g ->> 'rank')::smallint, g ->> 'source', (g ->> 'confidence')::real, p_map_version
    from jsonb_array_elements(coalesce(p_genres, '[]')) g;
  update public.book_enrichment set map_version = p_map_version where book_id = p_book;
end;
$$;

-- What the function asks to queue a Book on a member's behalf (the author page
-- or the Book page finding it never enriched). Answers whether it was queued.
create function public.enrich_request(p_book uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (select 1 from public.books where id = p_book and owner_id is null) then
    return false;
  end if;
  insert into private.enrich_queue (book_id, reason) values (p_book, 'member')
  on conflict (book_id) do update set reason = 'member', not_before = least(private.enrich_queue.not_before, now());
  return true;
end;
$$;

-- The queue at a glance, for the backfill script and the owner.
create function public.enrich_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'queued', (select count(*) from private.enrich_queue),
    'due', (select count(*) from private.enrich_queue where not_before <= now()
                                                     and (claimed_until is null or claimed_until < now())),
    'catalogue', (select count(*) from public.books where owner_id is null),
    'enriched', (select count(*) from public.book_enrichment where status = 'enriched'),
    'notFound', (select count(*) from public.book_enrichment where status = 'not_found'),
    'failed', (select count(*) from public.book_enrichment where status = 'failed')
  )
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.enrich_claim(integer, interval, uuid)', 'public.enrich_failed(uuid, text)',
    'public.enrich_backfill(integer)', 'public.enrich_refresh(integer)',
    'public.enrich_stale_authors(integer)', 'public.enrich_save(jsonb)',
    'public.enrich_save_genres(uuid, jsonb, integer)', 'public.enrich_request(uuid)',
    'public.enrich_status()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- ------------------------------------------------------------------- pg_cron

-- Every ten minutes, the call a waiting queue is owed (the trigger's own call
-- is debounced, and a failed Book waits for its time); daily, the refresh.
-- Scheduled where pg_cron is, as purge-synced-writes is; cheap when idle.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('enrich-drain', '*/10 * * * *', 'select private.enrich_kick()');
      perform cron.schedule('enrich-refresh', '20 4 * * *', 'select public.enrich_refresh(200)');
    exception when others then
      raise notice 'enrichment jobs could not be scheduled (%)', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not here: the enrichment queue is drained only by the books trigger or backfill.ts';
  end if;
end;
$$;
