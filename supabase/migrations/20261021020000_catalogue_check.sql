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
-- are unchecked too, so the check works through them over time (oldest first). The state a claim
-- needs (lease, attempts, backoff) lives in `private.catalogue_check_state`, one row per Book that
-- was ever claimed. A Manual book (owner_id set) is never checked, never claimed, and a constraint
-- keeps it so.
--
--   books.checked_at    null = not checked. Set when the source answered: with its data (saved) or
--                       without the Book (a miss), or with another Book (a mismatch).
--   books.check_failed  true when the source did not know the Book, or its answer was not this Book:
--                       checked_at is set, no source text was written, and the description is null.
--
-- A source that is down is no miss: the Book stays unchecked and is tried again after 5 min, 10,
-- 20 … at most a day.
--
-- A description is source text. A client never stores one for a Catalogue Book: `catalogue_book_for`
-- leaves it null, and so does every other insert of a Catalogue row (a trigger, `books_no_client_description`);
-- only `catalogue_check_save` writes it, from the source, and a miss or mismatch sets it null. So the column
-- stays readable as before, and holds only what a source said (a legacy row keeps the description a client
-- once sent until its check overwrites or clears it: `description_shown` still withholds it from others
-- until then). A Manual book (owner_id set) keeps its own, which only its owner reads.
--
-- What other members and the public reading page see of a Book:
--   checked          all of it, as the source said it.
--   unchecked        title, authors and a cover by the S1 allowlist (private.cover_shown), as now; not
--                    its description (private.description_shown).
--   failed           nothing a member sent: title null, authors [], no cover, no description, "unverified":
--                    true (private.book_shown), to everyone but members who have the Book in their own
--                    Library, who read their row as they added it. A search leaves it out for them.
-- A mismatch (the source's answer is another Book: a real ISBN with another Book's id) also clears the
-- row's source keys (isbn13, isbn10, apple_id, Open Library keys), so the unique indexes free them for an
-- honest add; the members who hold the row keep it.
-- Every answer that hands a Book to others asks book_shown: `reading_page_book_json` (so `social_book_json`,
-- the feed, profiles, want lists, the reading page's Books, you both read, the circle, likes),
-- `member_reading_record` (which also asks description_shown) and `search_books`.
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
  'Social v2a §5: the source did not know this Book, or its answer is not this Book (checked_at is set, nothing was written; others see it as unverified, private.book_shown).';

alter table public.books drop constraint if exists books_manual_unchecked;
alter table public.books add constraint books_manual_unchecked
  check (owner_id is null or (checked_at is null and not check_failed));

-- A Book the check found to be another Book (a mismatch) loses its source keys: it is then a failed row
-- with none (the unique indexes free them), so the key requirement holds for every row but those.
alter table public.books drop constraint if exists books_catalogue_key;
alter table public.books add constraint books_catalogue_key
  check (source = 'manual' or check_failed or coalesce(isbn13, apple_id, openlibrary_edition_key) is not null);

-- A client never stores a description for a Catalogue Book (see the header): whatever an insert says, a
-- Catalogue row starts without one. The check writes it (catalogue_check_save), from the source.
create or replace function private.books_no_client_description()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.owner_id is null then
    new.description := null;
  end if;
  return new;
end;
$$;

revoke all on function private.books_no_client_description() from public, anon, authenticated;

drop trigger if exists books_no_client_description on public.books;
create trigger books_no_client_description
  before insert on public.books
  for each row execute function private.books_no_client_description();

-- What the claim looks for: unchecked Catalogue Books, oldest first (a flood of new rows waits behind them).
drop index if exists public.books_unchecked;
create index books_unchecked on public.books (created_at)
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
  -- The function's address; null = off (nothing is sent; the Books stay unchecked). https only: the
  -- call carries a bearer secret.
  function_url    text,
  min_interval    interval not null default interval '50 seconds',
  last_kick_at    timestamptz,
  last_request_id bigint,
  -- What the last call that has answered said (pg_net's response; the kick reads it a minute later): its
  -- HTTP status (null when there was none: a timeout, no route) and the error or the start of the body
  -- when it was not a 2xx. A 401 here is a token the function does not know; see the function's README.
  last_status     integer,
  last_error      text,
  last_status_at  timestamptz
);

-- Re-runnable, and for a table that was made before: https only, and the status columns.
alter table private.catalogue_check_settings drop constraint if exists catalogue_check_settings_function_url_check;
alter table private.catalogue_check_settings add constraint catalogue_check_settings_function_url_check
  check (function_url ~ '^https://[^[:space:]]+$');
alter table private.catalogue_check_settings add column if not exists last_status integer;
alter table private.catalogue_check_settings add column if not exists last_error text;
alter table private.catalogue_check_settings add column if not exists last_status_at timestamptz;

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
  v_seen boolean;
  v_status integer;
  v_error text;
begin
  select * into v_settings from private.catalogue_check_settings where id;
  if v_settings.function_url is null then
    return 'off';
  end if;

  -- What the last call answered, once pg_net has it (it keeps responses for hours): a call that fails
  -- (a 401 for a wrong token, a 5xx, a timeout, no route) would otherwise leave the Books unchecked
  -- without a word. Read before anything else, so an idle or debounced kick records it too.
  if v_settings.last_request_id is not null and to_regclass('net._http_response') is not null then
    execute 'select true, status_code, case when status_code between 200 and 299 and error_msg is null then null '
            'else left(coalesce(error_msg, content), 500) end '
            'from net._http_response where id = $1'
      into v_seen, v_status, v_error using v_settings.last_request_id;
    if v_seen then
      update private.catalogue_check_settings
         set last_status = v_status, last_error = v_error, last_status_at = now()
       where id;
    end if;
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

-- ------------------------------------------------------------- flooding

-- How many new Catalogue Books a member has made today: at most 200 (private.catalogue_daily_limit).
-- Counted in catalogue_book_for, which every add goes through. A day's row is dropped a week later.
create table if not exists private.catalogue_additions (
  member_id uuid not null references auth.users on delete cascade,
  day       date not null default current_date,
  n         integer not null default 0,
  primary key (member_id, day)
);

comment on table private.catalogue_additions is
  'Social v2a §5: how many new Catalogue Books a member made on a day (catalogue_book_for refuses the 201st: catalogue_limit).';
revoke all on private.catalogue_additions from public, anon, authenticated;

-- catalogue_book_for, from its latest body (20261011090000_own_edition.sql), whole; the only change is
-- the count after a new row (and the description, which a client never stores for a Catalogue Book: null): a member makes at most 200 new Catalogue Books a day. The 201st is refused
-- with `catalogue_limit` (PT429) and the whole add rolls back; a Book that is in the Catalogue already
-- costs nothing (the first member's row is shared). Rows the check will read, one by one at the sources'
-- pace, cannot be made faster than that by one account.
create or replace function public.catalogue_book_for(p_book jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_book   public.books;
  v_id     uuid;
  v_member uuid := auth.uid();
  v_limit  constant integer := 200;
  v_count  integer;
begin
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  v_book := jsonb_populate_record(null::public.books, p_book);
  -- Normalised here too, so every client finds the same row.
  v_book.title   := nullif(btrim(v_book.title), '');
  v_book.isbn13  := nullif(upper(regexp_replace(v_book.isbn13, '[^0-9Xx]', '', 'g')), '');
  v_book.isbn10  := nullif(upper(regexp_replace(v_book.isbn10, '[^0-9Xx]', '', 'g')), '');
  v_book.authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(v_book.authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );
  if v_book.source = 'apple' then
    v_book.format := coalesce(v_book.format, 'ebook');
  end if;

  -- Only what search finds enters this way (see #41): Manual books have their
  -- own paths, and an `import` snapshot must match a Catalogue Book.
  if v_book.title is null
     or v_book.source is null
     or v_book.source not in ('apple', 'openlibrary', 'import')
     or coalesce(v_book.isbn13, v_book.apple_id, v_book.openlibrary_edition_key) is null then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  -- An ISBN match wins over a source match: the same edition found through
  -- another source is still the same Book.
  select id into v_id from public.books
   where owner_id is null and v_book.isbn13 is not null and isbn13 = v_book.isbn13;
  if v_id is null then
    select id into v_id from public.books
     where owner_id is null
       and ((v_book.apple_id is not null and apple_id = v_book.apple_id)
         or (v_book.openlibrary_edition_key is not null
             and openlibrary_edition_key = v_book.openlibrary_edition_key))
     limit 1;
  end if;

  if v_id is null and v_book.source = 'import' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if v_id is null then
    -- Two members adding the same new Book at once: the second insert waits for
    -- the first transaction, then does nothing, and the next statement (a new
    -- snapshot) finds the winner's row instead.
    insert into public.books (
      title, authors, isbn13, isbn10, page_count, published_year, language, publisher,
      description, cover_url, cover_thumbhash, cover_dominant, cover_secondary, source,
      apple_id, openlibrary_edition_key, openlibrary_work_key, format
    ) values (
      v_book.title, v_book.authors, v_book.isbn13, v_book.isbn10, v_book.page_count,
      v_book.published_year, v_book.language, v_book.publisher, null,
      v_book.cover_url, v_book.cover_thumbhash, lower(v_book.cover_dominant),
      lower(v_book.cover_secondary), v_book.source, v_book.apple_id,
      v_book.openlibrary_edition_key, v_book.openlibrary_work_key, v_book.format
    )
    on conflict do nothing
    returning id into v_id;

    -- A new row: it counts against the member's day (not a service-role or test call, which has no member).
    if v_id is not null and v_member is not null then
      insert into private.catalogue_additions as a (member_id, day, n)
      values (v_member, current_date, 1)
      on conflict (member_id, day) do update set n = a.n + 1 where a.n < v_limit
      returning a.n into v_count;
      if v_count is null then
        raise exception 'catalogue_limit' using errcode = 'PT429';
      end if;
      delete from private.catalogue_additions where member_id = v_member and day < current_date - 7;
    end if;

    if v_id is null then
      select id into v_id from public.books
       where owner_id is null
         and ((v_book.isbn13 is not null and isbn13 = v_book.isbn13)
           or (v_book.apple_id is not null and apple_id = v_book.apple_id)
           or (v_book.openlibrary_edition_key is not null
               and openlibrary_edition_key = v_book.openlibrary_edition_key))
       limit 1;
    end if;
    -- Only if the winner rolled back in between; the member can simply retry.
    if v_id is null then
      raise exception 'book_conflict' using errcode = '40001';
    end if;
  end if;

  return v_id;
end;
$$;

revoke all on function public.catalogue_book_for(jsonb) from public, anon, authenticated;

-- ------------------------------------------------------ the function's side

-- Claims up to p_limit unchecked Catalogue Books for p_lease: never tried first, then oldest first (legacy
-- rows included: a member who adds Books in bulk goes to the back of the queue, not the front).
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
     order by coalesce(s.attempts, 0), b.created_at, b.id
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

-- Stores what the source says for a claimed Book, and marks it checked: a verified Book is the
-- source's, all of it, and nothing of what the first member sent stays that the source did not say.
-- p_result:
--   title          text, 1–500 characters; required, and its work_title_key must be the stored title's
--                  (the function checks the identity; this is the second lock: a Book the source
--                  names otherwise is marked failed and nothing is written)
--   authors        text[], 1–20 names of at most 200 characters; else '{}'
--   description    text of at most 10000 characters; else null
--   cover_url      https URL at covers.openlibrary.org or *.mzstatic.com; else no cover (and no
--                  thumbhash or colours: a new URL drops the old ones, which described another picture)
--   publisher      text of at most 200 characters; else null
--   language       two or three lower-case letters; else null
--   format         hardcover | paperback | ebook | audiobook; else null
--   page_count     1–10000; the source's, else the Book's own when it is in range, else null
--   published_year 1000–next year; the source's, else the Book's own when it is in range, else null
-- The function validates too; this is the second lock on the door, because the writer is a
-- service that reads other people's answers. Answers false when there was nothing to write: no such
-- Book, a Manual book, a Book already checked, a title that is not the Book's.
create or replace function public.catalogue_check_save(p_book uuid, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_book        public.books;
  v_title       text;
  v_authors     text[];
  v_description text;
  v_cover       text;
  v_publisher   text;
  v_language    text;
  v_format      public.book_format;
  v_pages       integer;
  v_year        integer;
  v_max_year    integer := extract(year from now())::integer + 1;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'result_invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(p_result -> 'title') = 'string' then
    v_title := btrim(p_result ->> 'title');
  end if;
  if v_title is null or char_length(v_title) not between 1 and 500 then
    raise exception 'result_invalid' using errcode = '22023';
  end if;

  select * into v_book
    from public.books b
   where b.id = p_book and b.owner_id is null and b.checked_at is null
     for update;
  if not found then
    delete from private.catalogue_check_state where book_id = p_book;
    return false;
  end if;

  -- The source's record must be this Book's: the first member's title is the key the check was
  -- asked by (a real ISBN with another Book's id would otherwise write the other Book under it).
  if public.work_title_key(v_book.title) is distinct from public.work_title_key(v_title) then
    perform public.catalogue_check_mismatch(p_book);
    return false;
  end if;

  if jsonb_typeof(p_result -> 'authors') = 'array'
     and jsonb_array_length(p_result -> 'authors') between 1 and 20
     and not exists (select 1 from jsonb_array_elements(p_result -> 'authors') a
                      where jsonb_typeof(a) <> 'string' or char_length(btrim(a #>> '{}')) not between 1 and 200) then
    select array_agg(btrim(a #>> '{}') order by n) into v_authors
      from jsonb_array_elements(p_result -> 'authors') with ordinality as t(a, n);
  end if;

  if jsonb_typeof(p_result -> 'description') = 'string'
     and char_length(p_result ->> 'description') <= 10000 then
    v_description := nullif(btrim(p_result ->> 'description'), '');
  end if;

  if jsonb_typeof(p_result -> 'cover_url') = 'string'
     and char_length(p_result ->> 'cover_url') <= 500
     and (p_result ->> 'cover_url') ~* '^https://(covers\.openlibrary\.org|([a-z0-9-]+\.)+mzstatic\.com)/[^[:space:]]+$' then
    v_cover := p_result ->> 'cover_url';
  end if;

  if jsonb_typeof(p_result -> 'publisher') = 'string'
     and char_length(btrim(p_result ->> 'publisher')) between 1 and 200 then
    v_publisher := btrim(p_result ->> 'publisher');
  end if;

  if jsonb_typeof(p_result -> 'language') = 'string' and (p_result ->> 'language') ~ '^[a-z]{2,3}$' then
    v_language := p_result ->> 'language';
  end if;

  if jsonb_typeof(p_result -> 'format') = 'string'
     and (p_result ->> 'format') in ('hardcover', 'paperback', 'ebook', 'audiobook') then
    v_format := (p_result ->> 'format')::public.book_format;
  end if;

  -- Pages and year: the source's when it has them, else the Book's own, if plausible.
  if jsonb_typeof(p_result -> 'page_count') = 'number' and (p_result ->> 'page_count') ~ '^[0-9]{1,5}$'
     and (p_result ->> 'page_count')::integer between 1 and 10000 then
    v_pages := (p_result ->> 'page_count')::integer;
  elsif v_book.page_count between 1 and 10000 then
    v_pages := v_book.page_count;
  end if;

  if jsonb_typeof(p_result -> 'published_year') = 'number' and (p_result ->> 'published_year') ~ '^[0-9]{1,4}$'
     and (p_result ->> 'published_year')::integer between 1000 and v_max_year then
    v_year := (p_result ->> 'published_year')::integer;
  elsif v_book.published_year between 1000 and v_max_year then
    v_year := v_book.published_year;
  end if;

  update public.books b
     set title = v_title,
         authors = coalesce(v_authors, '{}'),
         description = v_description,
         cover_url = v_cover,
         -- The hash and colours describe the picture they came with: kept only if the source's cover is that URL.
         cover_thumbhash = case when v_cover is not null and v_cover is not distinct from b.cover_url then b.cover_thumbhash end,
         cover_dominant = case when v_cover is not null and v_cover is not distinct from b.cover_url then b.cover_dominant end,
         cover_secondary = case when v_cover is not null and v_cover is not distinct from b.cover_url then b.cover_secondary end,
         publisher = v_publisher,
         language = v_language,
         format = v_format,
         page_count = v_pages,
         published_year = v_year,
         checked_at = now(),
         check_failed = false
   where b.id = p_book;

  delete from private.catalogue_check_state where book_id = p_book;
  return true;
end;
$$;

-- The source answered and does not know the Book: checked, failed, no source text written and the
-- description (a legacy client's) null. The Book keeps its keys: it may be found later.
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
     set checked_at = now(), check_failed = true, description = null
   where id = p_book and owner_id is null and checked_at is null;
  v_found := found;
  delete from private.catalogue_check_state where book_id = p_book;
  return v_found;
end;
$$;

-- The source's answer is another Book than the row says (its keys or title disagree): checked, failed,
-- description null, and the source keys cleared, so the unique indexes free the ISBN, Apple id and edition
-- key a member paired with another Book's for an honest add. Members who hold the row keep it, and read it
-- as they added it (others see "unverified", private.book_shown).
create or replace function public.catalogue_check_mismatch(p_book uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_found boolean;
begin
  update public.books
     set checked_at = now(), check_failed = true, description = null,
         isbn13 = null, isbn10 = null, apple_id = null,
         openlibrary_edition_key = null, openlibrary_work_key = null
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

-- The check at a glance, and the last call the cron made with what it answered.
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
    'backingOff', (select count(*) from private.catalogue_check_state where not_before > now()),
    -- The last call the cron made and what it answered (a 401 here: the token the function has is not the Vault's).
    'lastKickAt', (select last_kick_at from private.catalogue_check_settings where id),
    'lastStatus', (select last_status from private.catalogue_check_settings where id),
    'lastError', (select last_error from private.catalogue_check_settings where id)
  )
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.catalogue_check_claim(integer, interval)', 'public.catalogue_check_save(uuid, jsonb)',
    'public.catalogue_check_miss(uuid)', 'public.catalogue_check_mismatch(uuid)', 'public.catalogue_check_failed(uuid, text)',
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

-- Whether a Book may be handed to somebody else as what it says it is. A Book the check could not
-- confirm (its source does not know it, or its answer is not this Book: check_failed) is shown to no
-- one but the members who have it in their own Library, where it is her row as she added it; to
-- everyone else (a follower, a visitor of a reading page, the search) it is nothing a member sent.
-- Every answer that hands a Book to others asks this, as the cover ones ask cover_shown.
-- `auth.uid()` is the member asking; null (the public reading page) has no Library.
create or replace function private.book_shown(p_book public.books)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select not p_book.check_failed
      or exists (select 1 from public.library_entries e
                  where e.member_id = (select auth.uid()) and e.book_id = p_book.id)
$$;

revoke all on function private.book_shown(public.books) from public, anon, authenticated;

-- A Book as followers and reading pages see it (20261017060000_social_gate2.sql's, whole): every
-- function that hands a Book to someone else goes through this one, the feed, member_profile and
-- member_want (by social_book_json), the public reading page and its cards. A Book that is not
-- shown (private.book_shown) is `unverified`: no title, no authors, no cover, no description, no year.
create or replace function private.reading_page_book_json(p_book public.books)
returns jsonb
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select case when private.book_shown(p_book) then
    jsonb_build_object(
      'id', p_book.id,
      'title', p_book.title,
      'authors', to_jsonb(p_book.authors),
      'published_year', p_book.published_year,
      'cover_url', case when private.cover_shown(p_book) then p_book.cover_url end,
      'cover_thumbhash', case when private.cover_shown(p_book) then p_book.cover_thumbhash end,
      'cover_dominant', case when private.cover_shown(p_book) then p_book.cover_dominant end,
      'cover_secondary', case when private.cover_shown(p_book) then p_book.cover_secondary end
    )
  else
    jsonb_build_object(
      'id', p_book.id,
      'title', null,
      'authors', '[]'::jsonb,
      'published_year', null,
      'cover_url', null,
      'cover_thumbhash', null,
      'cover_dominant', null,
      'cover_secondary', null,
      'description', null,
      'unverified', true
    )
  end
$$;

revoke all on function private.reading_page_book_json(public.books) from public, anon, authenticated;

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
               -- A Book that is not shown (private.book_shown) is `unverified`: nothing a member sent.
               'book', case when private.book_shown(b) then jsonb_build_object(
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
               else jsonb_build_object(
                 'id', b.id,
                 'created_at', b.created_at,
                 'title', null,
                 'authors', '[]'::jsonb,
                 'isbn13', null,
                 'isbn10', null,
                 'page_count', null,
                 'published_year', null,
                 'language', null,
                 'publisher', null,
                 'description', null,
                 'cover_url', null,
                 'cover_thumbhash', null,
                 'cover_dominant', null,
                 'cover_secondary', null,
                 'source', b.source,
                 'apple_id', null,
                 'openlibrary_edition_key', null,
                 'openlibrary_work_key', null,
                 'format', null,
                 'goodreads', null,
                 'unverified', true)
               end
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

-- search_books, from its latest body (20261020020000_search_books_index.sql), whole; a search hands
-- rows to others, so a Book that is not shown (private.book_shown: the check could not confirm it, and
-- she does not have it in her Library) is left out.
create or replace function public.search_books(p_query text, p_limit integer default 20)
returns setof public.books
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_isbn13 text := regexp_replace(coalesce(p_query, ''), '[\s-]', '', 'g');
  v_words  tsquery;
  v_text   text;
begin
  if v_isbn13 ~ '^97[89][0-9]{10}$' then
    return query
      select books.* from public.books
       where books.isbn13 = v_isbn13
         -- books_readable, word for word
         and (books.owner_id is null or books.owner_id = (select auth.uid()))
         and private.book_shown(books)
       order by books.owner_id is null, books.created_at desc, books.id
       limit v_limit;
    return;
  end if;

  v_words := public.book_search_query(p_query);
  if v_words is null then
    return;
  end if;
  v_text := btrim(public.book_search_text(p_query, '{}'));
  return query
    select books.* from private.book_search s
      join public.books on books.id = s.book_id
     where s.words @@ v_words
       -- books_readable, word for word
       and (books.owner_id is null or books.owner_id = (select auth.uid()))
       and private.book_shown(books)
     order by s.title = v_text desc,
              ts_rank(s.words, v_words) desc,
              books.created_at desc,
              books.id
     limit v_limit;
end;
$$;

comment on function public.search_books(text, integer) is
  'Catalogue search: the Books the caller can see (the Catalogue and her own Manual books) whose '
  'title and authors begin with the typed words, accents ignored; an ISBN-13 by ISBN. Best first. '
  'Security definer: applies the books_readable rule itself, so the words index is usable. A Book '
  'the check could not confirm is left out unless she has it in her Library (private.book_shown).';

revoke all on function public.search_books(text, integer) from public, anon;
grant execute on function public.search_books(text, integer) to authenticated;

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
