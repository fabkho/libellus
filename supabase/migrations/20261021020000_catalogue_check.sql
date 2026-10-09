-- A checked Catalogue (social v2a contract §5): a Catalogue Book's title, authors, description and
-- cover are what the first member to add it sent (`catalogue_book_for` keeps the first snapshot and
-- never rewrites it). That is fine in her own Library, but other members' screens and the public
-- reading page show the row too, so a server check reads the Book at its source (Apple, Open
-- Library) and writes what the source says.
--
--   pg_cron 'catalogue-check' (every minute)
--     → private.catalogue_check_kick()    only when an unchecked Book is due; at most one call in 50 s
--     → pg_net → POST <function_url>      {"action": "drain"}, Bearer <Vault catalogue_check_token>
--     → catalogue-check: catalogue_check_claim(n) → Apple / Open Library
--                        → catalogue_check_save(book, result) | catalogue_check_miss(book)
--                          | catalogue_check_failed(book, error) | catalogue_check_release(book)
--
-- Where the function cannot be called (the local stack, CI, no URL or token configured) nothing is
-- sent and nothing fails: the Books simply stay unchecked.
--
-- The queue is implicit: every Catalogue Book (owner_id null) with `checked_at` null. Existing rows
-- are unchecked too, so the check works through them over time (newest first). The state a claim
-- needs (lease, attempts, backoff) lives in `private.catalogue_check_state`, one row per Book that
-- was ever claimed. A Manual book (owner_id set) is never checked, never claimed, and a constraint
-- keeps it so.
--
--   books.checked_at    null = not checked. Set when the source answered: with its data (saved) or
--                       without the Book (a miss).
--   books.check_failed  true when the source did not know the Book: checked_at is set, the data stay.
--
-- A source that is down is no miss: the Book stays unchecked and is tried again after 5 min, 10,
-- 20 … at most a day.
--
-- What other members and the public reading page see of an unchecked Book: title, authors and a
-- cover by the S1 allowlist (private.cover_shown), as now; not its description
-- (private.description_shown). `reading_page_book_json` (so `social_book_json`, the feed, profiles,
-- want lists and the reading page's Books) carries no description at all, by design; the one answer
-- that handed a description to others, `member_reading_record`, now asks description_shown. A Book
-- whose check failed (its source does not know it) is withheld too: nothing vouches for its text.
-- The member's own Library reads `books` directly and shows the row as she added it.
--
-- The function's address and secret, once, by the owner (supabase/functions/catalogue-check/README.md):
--
--   update private.catalogue_check_settings set function_url = 'https://<ref>.supabase.co/functions/v1/catalogue-check';
--   select vault.create_secret('<the CATALOGUE_CHECK_TOKEN function secret>', 'catalogue_check_token');
--
-- Re-runnable: create or replace, drop … if exists.

create schema if not exists private;

-- ---------------------------------------------------------------- the columns

alter table public.books add column if not exists checked_at timestamptz;
alter table public.books add column if not exists check_failed boolean not null default false;

comment on column public.books.checked_at is
  'Social v2a §5: when the catalogue-check function read this Catalogue Book at its source; null = not checked. '
  'Manual books are never checked.';
comment on column public.books.check_failed is
  'Social v2a §5: the source did not know this Book (checked_at is set, the data are as the first member sent them).';

alter table public.books drop constraint if exists books_manual_unchecked;
alter table public.books add constraint books_manual_unchecked
  check (owner_id is null or (checked_at is null and not check_failed));

-- What the claim looks for: unchecked Catalogue Books, newest first.
create index if not exists books_unchecked on public.books (created_at desc)
  where owner_id is null and checked_at is null;

-- ------------------------------------------------------------- the state

create table if not exists private.catalogue_check_state (
  book_id        uuid primary key references public.books on delete cascade,
  attempts       integer not null default 0,
  -- Not before this (a failed attempt waits longer each time).
  not_before     timestamptz not null default now(),
  -- Claimed by a running function until then; a crashed run's claim lapses.
  claimed_until  timestamptz,
  last_error     text
);

comment on table private.catalogue_check_state is
  'Social v2a §5: lease, attempts and backoff of Catalogue Books the catalogue-check function claimed.';
revoke all on private.catalogue_check_state from public, anon, authenticated;

create table if not exists private.catalogue_check_settings (
  id              boolean primary key default true check (id),
  -- The function's address; null = off (nothing is sent; the Books stay unchecked).
  function_url    text check (function_url ~ '^https?://'),
  min_interval    interval not null default interval '50 seconds',
  last_kick_at    timestamptz,
  last_request_id bigint
);

comment on table private.catalogue_check_settings is
  'Social v2a §5: where the catalogue-check edge function is (null = off) and when it was last called. '
  'One row. Its token is the Vault secret catalogue_check_token.';

insert into private.catalogue_check_settings default values on conflict (id) do nothing;
revoke all on private.catalogue_check_settings from public, anon, authenticated;

-- --------------------------------------------------------------- the kick

-- Whether a Book is due: unchecked, not backing off, not claimed.
create or replace function private.catalogue_check_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.books b
      left join private.catalogue_check_state s on s.book_id = b.id
     where b.owner_id is null and b.checked_at is null
       and coalesce(s.not_before, '-infinity') <= now()
       and (s.claimed_until is null or s.claimed_until < now())
  )
$$;

-- Calls the function to check the Books that are due, when the function can be called here and the
-- last call is at least `min_interval` ago. Answers what it did: 'off', 'idle', 'debounced',
-- 'unavailable' or 'sent'.
create or replace function private.catalogue_check_kick()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings private.catalogue_check_settings;
  v_token text;
  v_request bigint;
begin
  select * into v_settings from private.catalogue_check_settings where id;
  if v_settings.function_url is null then
    return 'off';
  end if;
  if not private.catalogue_check_due() then
    return 'idle';
  end if;
  if to_regprocedure('net.http_post(text, jsonb, jsonb, jsonb, integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return 'unavailable';
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'catalogue_check_token';
  if nullif(btrim(v_token), '') is null then
    return 'unavailable';
  end if;

  update private.catalogue_check_settings
     set last_kick_at = now()
   where id and coalesce(last_kick_at, '-infinity') <= now() - min_interval;
  if not found then
    return 'debounced';
  end if;

  -- pg_net waits in the background, never in this transaction.
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 120000)'
    into v_request
    using v_settings.function_url,
          jsonb_build_object('action', 'drain'),
          jsonb_build_object('Authorization', 'Bearer ' || btrim(v_token),
                             'Content-Type', 'application/json');
  update private.catalogue_check_settings set last_request_id = v_request where id;
  return 'sent';
end;
$$;

revoke all on function private.catalogue_check_due() from public, anon, authenticated;
revoke all on function private.catalogue_check_kick() from public, anon, authenticated;

-- ------------------------------------------------------ the function's side

-- Claims up to p_limit unchecked Catalogue Books for p_lease: never tried first, then newest first.
-- A Manual book is never due (and cannot be: books_manual_unchecked).
create or replace function public.catalogue_check_claim(p_limit integer default 8, p_lease interval default interval '3 minutes')
returns setof public.books
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with due as (
    select b.id
      from public.books b
      left join private.catalogue_check_state s on s.book_id = b.id
     where b.owner_id is null and b.checked_at is null
       and coalesce(s.not_before, '-infinity') <= now()
       and (s.claimed_until is null or s.claimed_until < now())
     order by coalesce(s.attempts, 0), b.created_at desc
     limit greatest(1, least(coalesce(p_limit, 8), 50))
     for update of b skip locked
  ),
  claimed as (
    insert into private.catalogue_check_state as st (book_id, attempts, claimed_until)
    select due.id, 1, now() + p_lease from due
    on conflict (book_id) do update
       set attempts = st.attempts + 1, claimed_until = excluded.claimed_until
    returning st.book_id
  )
  select b.* from public.books b join claimed c on c.book_id = b.id;
end;
$$;

-- Stores what the source says for a claimed Book, and marks it checked. p_result:
--   title        text, 1–500 characters        (else the Book keeps its title)
--   authors      text[], 1–20 names of at most 200 characters (else it keeps its authors)
--   description  text of at most 10000 characters, or null: the source's, whatever the Book had
--                (omitted = kept)
--   cover_url    https URL at covers.openlibrary.org or *.mzstatic.com (else the Book keeps its
--                cover); a new URL drops the old thumbhash and colours, which described another picture
-- The function validates too; this is the second lock on the door, because the writer is a
-- service that reads other people's answers. Answers false when there was nothing to write: no such
-- Book, a Manual book, a Book already checked.
create or replace function public.catalogue_check_save(p_book uuid, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_title text;
  v_authors text[];
  v_has_description boolean := false;
  v_description text;
  v_cover text;
  v_found boolean;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'result_invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(p_result -> 'title') = 'string' then
    v_title := btrim(p_result ->> 'title');
    if char_length(v_title) not between 1 and 500 then
      v_title := null;
    end if;
  end if;

  if jsonb_typeof(p_result -> 'authors') = 'array'
     and jsonb_array_length(p_result -> 'authors') between 1 and 20
     and not exists (select 1 from jsonb_array_elements(p_result -> 'authors') a
                      where jsonb_typeof(a) <> 'string' or char_length(btrim(a #>> '{}')) not between 1 and 200) then
    select array_agg(btrim(a #>> '{}') order by n) into v_authors
      from jsonb_array_elements(p_result -> 'authors') with ordinality as t(a, n);
  end if;

  if p_result ? 'description' then
    if jsonb_typeof(p_result -> 'description') = 'null' then
      v_has_description := true;
    elsif jsonb_typeof(p_result -> 'description') = 'string' then
      v_description := nullif(btrim(p_result ->> 'description'), '');
      v_has_description := char_length(coalesce(v_description, '')) <= 10000;
      if not v_has_description then
        v_description := null;
      end if;
    end if;
  end if;

  if jsonb_typeof(p_result -> 'cover_url') = 'string'
     and char_length(p_result ->> 'cover_url') <= 500
     and (p_result ->> 'cover_url') ~* '^https://(covers\.openlibrary\.org|([a-z0-9-]+\.)+mzstatic\.com)/[^[:space:]]+$' then
    v_cover := p_result ->> 'cover_url';
  end if;

  update public.books b
     set title = coalesce(v_title, b.title),
         authors = coalesce(v_authors, b.authors),
         description = case when v_has_description then v_description else b.description end,
         cover_url = coalesce(v_cover, b.cover_url),
         cover_thumbhash = case when v_cover is not null and v_cover is distinct from b.cover_url then null else b.cover_thumbhash end,
         cover_dominant = case when v_cover is not null and v_cover is distinct from b.cover_url then null else b.cover_dominant end,
         cover_secondary = case when v_cover is not null and v_cover is distinct from b.cover_url then null else b.cover_secondary end,
         checked_at = now(),
         check_failed = false
   where b.id = p_book and b.owner_id is null and b.checked_at is null;
  v_found := found;

  delete from private.catalogue_check_state where book_id = p_book;
  return v_found;
end;
$$;

-- The source answered and does not know the Book: checked, failed, the data stay as they were.
create or replace function public.catalogue_check_miss(p_book uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_found boolean;
begin
  update public.books
     set checked_at = now(), check_failed = true
   where id = p_book and owner_id is null and checked_at is null;
  v_found := found;
  delete from private.catalogue_check_state where book_id = p_book;
  return v_found;
end;
$$;

-- A claimed Book could not be checked (a source was down): back, to be tried after 5 minutes, then
-- 10, 20, … at most a day. Never gives up: an unchecked Book only keeps its description withheld.
create or replace function public.catalogue_check_failed(p_book uuid, p_error text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update private.catalogue_check_state
     set claimed_until = null,
         last_error = left(p_error, 500),
         not_before = now() + least(interval '5 minutes' * power(2, least(greatest(attempts - 1, 0), 10)), interval '1 day')
   where book_id = p_book
$$;

-- A claimed Book that was not tried (the run ran out of time): back at once, the attempt not counted.
create or replace function public.catalogue_check_release(p_book uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update private.catalogue_check_state
     set claimed_until = null, attempts = greatest(attempts - 1, 0)
   where book_id = p_book
$$;

-- The check at a glance.
create or replace function public.catalogue_check_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'unchecked', (select count(*) from public.books where owner_id is null and checked_at is null),
    'checked', (select count(*) from public.books where owner_id is null and checked_at is not null and not check_failed),
    'failed', (select count(*) from public.books where owner_id is null and check_failed),
    'backingOff', (select count(*) from private.catalogue_check_state where not_before > now())
  )
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.catalogue_check_claim(integer, interval)', 'public.catalogue_check_save(uuid, jsonb)',
    'public.catalogue_check_miss(uuid)', 'public.catalogue_check_failed(uuid, text)',
    'public.catalogue_check_release(uuid)', 'public.catalogue_check_status()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end;
$$;

-- ------------------------------------------------------ what others may read

-- Whether a Book's description may be shown to somebody else: only once the check read it at its
-- source. Callers drop the description, as the cover ones drop the cover (private.cover_shown).
create or replace function private.description_shown(p_book public.books)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_book.checked_at is not null and not p_book.check_failed
$$;

revoke all on function private.description_shown(public.books) from public, anon, authenticated;

-- member_reading_record, from its latest body (20261017060000_social_gate2.sql), whole; only the
-- Book's description changed: `private.description_shown`. Grants as they were.
create or replace function public.member_reading_record(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_s      public.social_settings;
  v_reads  jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.visible(v_caller, p_member) then
    return null;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_year then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', s.id,
             'entry_id', s.entry_id,
             'started_on', s.started_on,
             'ended_on', s.ended_on,
             'outcome', s.outcome,
             'rating', case when v_s.show_ratings then s.rating end,
             'created_at', s.created_at,
             'entry', jsonb_build_object(
               'page_count_override', e.page_count_override,
               -- The Book by the columns bookFromRow reads, named: never owner_id, nor a column added later.
               'book', jsonb_build_object(
                 'id', b.id,
                 'created_at', b.created_at,
                 'title', b.title,
                 'authors', b.authors,
                 'isbn13', b.isbn13,
                 'isbn10', b.isbn10,
                 'page_count', b.page_count,
                 'published_year', b.published_year,
                 'language', b.language,
                 'publisher', b.publisher,
                 -- Withheld until the server's check has read it at its source (private.description_shown).
                 'description', case when private.description_shown(b) then b.description end,
                 -- A cover only where private.cover_shown says (1. above); else the Placeholder.
                 'cover_url', case when private.cover_shown(b) then b.cover_url end,
                 'cover_thumbhash', case when private.cover_shown(b) then b.cover_thumbhash end,
                 'cover_dominant', case when private.cover_shown(b) then b.cover_dominant end,
                 'cover_secondary', case when private.cover_shown(b) then b.cover_secondary end,
                 'source', b.source,
                 'apple_id', b.apple_id,
                 'openlibrary_edition_key', b.openlibrary_edition_key,
                 'openlibrary_work_key', b.openlibrary_work_key,
                 'format', b.format,
                 'goodreads', null)
             )
           ) order by s.ended_on nulls last, s.created_at, s.id), '[]'::jsonb)
    into v_reads
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
    join public.books b on b.id = e.book_id
   where e.member_id = p_member and not e.hidden
     and ((s.outcome = 'finished' and v_s.show_finished)
          or (s.outcome = 'abandoned' and v_s.show_abandoned));

  return jsonb_build_object(
    'reads', v_reads,
    'wantToRead', case when v_s.show_want then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden and e.status = 'want_to_read') end,
    'reading', case when v_s.show_reading then
      (select count(*) from public.library_entries e
        where e.member_id = p_member and not e.hidden
          and exists (select 1 from public.reading_sessions s
                       where s.entry_id = e.id and s.outcome is null)) end
  );
end;
$$;

revoke all on function public.member_reading_record(uuid) from public, anon;
grant execute on function public.member_reading_record(uuid) to authenticated;

-- ------------------------------------------------------------------- pg_cron

-- Every minute, the call a waiting Book is owed (cheap when idle: one indexed look). Scheduled where
-- pg_cron is, as the enrichment's are.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.schedule('catalogue-check', '* * * * *', 'select private.catalogue_check_kick()');
    exception when others then
      raise notice 'the catalogue check could not be scheduled (%)', sqlerrm;
    end;
  else
    raise notice 'pg_cron is not here: the Catalogue is checked only when private.catalogue_check_kick() is called';
  end if;
end;
$$;
