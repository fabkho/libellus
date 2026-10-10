-- Social version 2a, database (docs/proposals/social-v2a-contract.md §1): spoiler-safe reviews, likes,
-- "you both read", and who reads or wants the same book.
--
--   1.1  reading_sessions.review_spoilers, written wherever `review` is (finish_reading, update_session,
--        add_to_library, add_manual_book, sync_write; the old calls work unchanged: the flag defaults to false). Every
--        answer that hands another member's review out says `spoilers` and, when the caller has no
--        finished read of the same book (and is not the author), `folded: true`: the review is still
--        sent, the client hides it behind "Show anyway". A visitor without a sign-in is always folded.
--   1.2  public.likes, like / unlike / session_likers / my_recent_likes; `likes`, `liked` and `sessionId`
--        on the feed's finished/reviewed rows and the profile's finished rows. A like is on a finished
--        read; who may like is who may see it (accepted follower or public account, show_finished on,
--        Book not hidden, no block either way). The count counts only likes that are still allowed.
--        Likes leave with the follow they were given under (a trigger on follows) and with a block (a
--        trigger on blocks, both ways); a hidden Book's likes stay but are not counted or listed.
--   1.3  both_read: the Books the caller and a member both finished.
--   1.4  circle_reading / circle_want: who she follows reads (or wants) the same Book.
--
-- Not changed: who may see what. Everything reuses private.visible / private.reachable /
-- private.social_of / private.blocked_either / private.member_card of social v1. "Same book" is the
-- same books.id or the same non-null openlibrary_work_key.
--
-- Beyond the contract: private.like_calls (the hourly limit needs the calls: a like that is taken back
-- leaves no row in public.likes), an index on books.openlibrary_work_key (the same-book joins), and
-- like / unlike answer `{ "likes": n, "liked": bool }`.
--
-- Re-runnable: create or replace, drop … if exists. A function whose signature gains an argument is
-- dropped first (an overload would make PostgREST's /rpc ambiguous).

-- ------------------------------------------------------------------ tables and columns

alter table public.reading_sessions add column if not exists review_spoilers boolean not null default false;

create index if not exists books_openlibrary_work_key on public.books (openlibrary_work_key)
  where openlibrary_work_key is not null;

create table if not exists public.likes (
  member_id  uuid not null references public.accounts on delete cascade,
  session_id uuid not null references public.reading_sessions on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, session_id)
);
create index if not exists likes_session on public.likes (session_id, created_at desc);
alter table public.likes enable row level security;
revoke all on public.likes from anon, authenticated;
comment on table public.likes is
  'Social v2a: a member''s like of another member''s finished read. No grants: written and read only '
  'through like(), unlike(), session_likers(), my_recent_likes() and the counts the readers hand out.';

-- Calls of like() that added a like, for the hourly limit; rows older than a day are deleted by like().
create table if not exists private.like_calls (
  member_id uuid not null references auth.users on delete cascade,
  at        timestamptz not null default now()
);
create index if not exists like_calls_member_at on private.like_calls (member_id, at);
alter table private.like_calls enable row level security;

-- finish_reading: as 20261003102707_reading_sessions.sql has it, plus `p_review_spoilers`.
drop function if exists public.finish_reading(uuid, date, integer, text);
create or replace function public.finish_reading(
  p_entry_id uuid,
  p_ended_on date,
  p_rating   integer default null,
  p_review   text default null,
  p_review_spoilers boolean default false
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review  text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
  v_session public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform 1 from public.library_entries
   where id = p_entry_id and member_id = v_member
     for update;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- Locked too: a write that skips the entry (the import, as the service role)
  -- cannot close it under us; one that did finds it gone here.
  select * into v_session from public.reading_sessions
   where entry_id = p_entry_id and outcome is null
     for update;
  if not found then
    raise exception 'not_reading' using errcode = '22023';
  end if;
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_ended_on < v_session.started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;

  update public.reading_sessions
     set ended_on = p_ended_on,
         outcome  = 'finished',
         rating   = p_rating,
         review   = v_review,
         review_spoilers = (v_review is not null and coalesce(p_review_spoilers, false))
   where id = v_session.id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.finish_reading(uuid, date, integer, text, boolean) from public, anon;
grant execute on function public.finish_reading(uuid, date, integer, text, boolean) to authenticated;
-- update_session: as 20261003113600_session_history.sql has it, plus `p_review_spoilers` (the whole
-- state of the read, as the other arguments: a blank review has no flag).
drop function if exists public.update_session(uuid, date, date, integer, text, text);
create or replace function public.update_session(
  p_session_id     uuid,
  p_started_on     date,
  p_ended_on       date,
  p_rating         integer default null,
  p_review         text default null,
  p_abandon_reason text default null,
  p_review_spoilers boolean default false
)
returns public.reading_sessions
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member   uuid := auth.uid();
  -- Trimmed of spaces and line breaks; blank is none.
  v_review   text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
  v_reason   text := nullif(regexp_replace(p_abandon_reason, '^\s+|\s+$', '', 'g'), '');
  v_entry_id uuid;
  v_session  public.reading_sessions;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  -- The entry first and locked, then the read: the order the other actions lock in.
  select s.entry_id into v_entry_id
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id
   where s.id = p_session_id and e.member_id = v_member;
  if v_entry_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  perform 1 from public.library_entries where id = v_entry_id for update;
  select * into v_session from public.reading_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;

  if v_session.outcome is null then
    -- Still being read.
    if p_ended_on is not null or p_rating is not null or v_review is not null or v_reason is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    if p_started_on is null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
  else
    if v_session.outcome = 'finished' then
      if v_reason is not null then
        raise exception 'session_invalid' using errcode = '22023';
      end if;
    elsif p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    if p_ended_on is null and v_session.ended_on is not null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
    if p_started_on > p_ended_on then
      raise exception 'ended_before_started' using errcode = '22023';
    end if;
    if p_rating is not null and p_rating not between 1 and 20 then
      raise exception 'rating_invalid' using errcode = '22023';
    end if;
    if char_length(v_review) > 10000 then
      raise exception 'review_too_long' using errcode = '22023';
    end if;
    if char_length(v_reason) > 1000 then
      raise exception 'reason_too_long' using errcode = '22023';
    end if;
  end if;

  -- The future check is the sessions trigger's; the entry's Status follows from
  -- the dates through the other one.
  update public.reading_sessions
     set started_on     = p_started_on,
         ended_on       = p_ended_on,
         rating         = p_rating,
         review         = v_review,
         review_spoilers = (v_review is not null and coalesce(p_review_spoilers, false)),
         abandon_reason = v_reason
   where id = p_session_id
  returning * into v_session;
  return v_session;
end;
$$;

revoke all on function public.update_session(uuid, date, date, integer, text, text, boolean) from public, anon;
grant execute on function public.update_session(uuid, date, date, integer, text, text, boolean) to authenticated;
-- add_first_session (internal) and add_to_library: as 20261003112000 / 20261003132457 have them, plus
-- `p_review_spoilers`.
drop function if exists public.add_to_library(jsonb, public.entry_status, date, date, integer, text);
drop function if exists public.add_first_session(uuid, public.entry_status, date, date, integer, text);
create or replace function public.add_first_session(
  p_entry_id   uuid,
  p_status     public.entry_status,
  p_started_on date,
  p_ended_on   date,
  p_rating     integer,
  p_review     text,
  p_review_spoilers boolean default false
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  -- Trimmed of spaces and line breaks; a blank review is no review.
  v_review text := nullif(regexp_replace(p_review, '^\s+|\s+$', '', 'g'), '');
begin
  if p_status = 'want_to_read' then
    if p_started_on is not null or p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    return;
  end if;

  if p_status = 'reading' then
    if p_started_on is null then
      raise exception 'date_invalid' using errcode = '22023';
    end if;
    if p_ended_on is not null or p_rating is not null or v_review is not null then
      raise exception 'session_invalid' using errcode = '22023';
    end if;
    insert into public.reading_sessions (entry_id, started_on) values (p_entry_id, p_started_on);
    return;
  end if;

  -- finished
  if p_ended_on is null then
    raise exception 'date_invalid' using errcode = '22023';
  end if;
  if p_started_on is not null and p_ended_on < p_started_on then
    raise exception 'ended_before_started' using errcode = '22023';
  end if;
  if p_rating is not null and p_rating not between 1 and 20 then
    raise exception 'rating_invalid' using errcode = '22023';
  end if;
  if char_length(v_review) > 10000 then
    raise exception 'review_too_long' using errcode = '22023';
  end if;
  insert into public.reading_sessions (entry_id, started_on, ended_on, outcome, rating, review, review_spoilers)
  values (p_entry_id, p_started_on, p_ended_on, 'finished', p_rating, v_review,
          v_review is not null and coalesce(p_review_spoilers, false));
end;
$$;

revoke all on function public.add_first_session(uuid, public.entry_status, date, date, integer, text, boolean)
  from public, anon, authenticated;
create or replace function public.add_to_library(
  p_book       jsonb,
  p_status     public.entry_status default 'want_to_read',
  p_started_on date default null,
  p_ended_on   date default null,
  p_rating     integer default null,
  p_review     text default null,
  p_review_spoilers boolean default false
)
returns public.library_entries
language plpgsql
security definer
-- pg_catalog first: a security-definer body must not pick up a function someone
-- shadowed in public.
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_id     uuid;
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  v_id := public.catalogue_book_for(p_book);

  begin
    insert into public.library_entries (member_id, book_id)
    values (v_member, v_id)
    returning * into v_entry;
  exception when unique_violation then
    raise exception 'already_in_library' using errcode = '23505';
  end;

  -- Raises on anything wrong with the dates, Rating or review, which undoes
  -- the entry (and a Book this call added) with it.
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review, p_review_spoilers);

  -- The status the session gave it.
  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$$;

revoke all on function public.add_to_library(jsonb, public.entry_status, date, date, integer, text, boolean)
  from public, anon;
grant execute on function public.add_to_library(jsonb, public.entry_status, date, date, integer, text, boolean)
  to authenticated;
-- add_manual_book: as 20261003112000_add_with_any_status.sql has it, plus `p_review_spoilers` (online only:
-- sync_write does not queue it).
drop function if exists public.add_manual_book(text, text[], text, integer, public.entry_status, date, date, integer, text);
create or replace function public.add_manual_book(
  p_title      text,
  p_authors    text[],
  p_isbn       text default null,
  p_page_count integer default null,
  p_status     public.entry_status default 'want_to_read',
  p_started_on date default null,
  p_ended_on   date default null,
  p_rating     integer default null,
  p_review     text default null,
  p_review_spoilers boolean default false
)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_title   text := nullif(btrim(p_title), '');
  v_authors text[];
  v_isbn    text := nullif(upper(regexp_replace(coalesce(p_isbn, ''), '[\s-]', '', 'g')), '');
  v_isbn13  text;
  v_isbn10  text;
  v_sum     integer;
  v_book    uuid;
  v_entry   public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  v_authors := coalesce(
    (select array_agg(btrim(a) order by n) from unnest(p_authors) with ordinality as t(a, n)
      where nullif(btrim(a), '') is not null),
    '{}'
  );
  if v_title is null or char_length(v_title) > 500 or cardinality(v_authors) = 0
     or p_page_count <= 0 then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if v_isbn is not null then
    if v_isbn ~ '^97[89][0-9]{10}$' then
      v_sum := 0;
      for i in 1..13 loop
        v_sum := v_sum + substr(v_isbn, i, 1)::integer * case when i % 2 = 1 then 1 else 3 end;
      end loop;
      if v_sum % 10 <> 0 then
        raise exception 'isbn_invalid' using errcode = '22023';
      end if;
      v_isbn13 := v_isbn;
    elsif v_isbn ~ '^[0-9]{9}[0-9X]$' then
      v_sum := 0;
      for i in 1..10 loop
        v_sum := v_sum + (case when substr(v_isbn, i, 1) = 'X' then 10 else substr(v_isbn, i, 1)::integer end)
                         * (11 - i);
      end loop;
      if v_sum % 11 <> 0 then
        raise exception 'isbn_invalid' using errcode = '22023';
      end if;
      v_isbn10 := v_isbn;
      -- The same edition as an ISBN-13: 978, the nine digits, a new check digit.
      v_sum := 0;
      for i in 1..12 loop
        v_sum := v_sum + substr('978' || substr(v_isbn, 1, 9), i, 1)::integer
                         * case when i % 2 = 1 then 1 else 3 end;
      end loop;
      v_isbn13 := '978' || substr(v_isbn, 1, 9) || ((10 - v_sum % 10) % 10)::text;
    else
      raise exception 'isbn_invalid' using errcode = '22023';
    end if;
  end if;

  insert into public.books (title, authors, isbn13, isbn10, page_count, source, owner_id)
  values (v_title, v_authors, v_isbn13, v_isbn10, p_page_count, 'manual', v_member)
  returning id into v_book;

  insert into public.library_entries (member_id, book_id)
  values (v_member, v_book)
  returning * into v_entry;

  -- Raises on anything wrong with the dates, Rating or review, which undoes the
  -- Book and the entry with it.
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review, p_review_spoilers);

  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$$;

revoke all on function public.add_manual_book(
  text, text[], text, integer, public.entry_status, date, date, integer, text, boolean
) from public, anon;
grant execute on function public.add_manual_book(
  text, text[], text, integer, public.entry_status, date, date, integer, text, boolean
) to authenticated;
-- sync_write: the latest (20261017010000_social_settings.sql), the three actions that carry a review
-- passing `p_review_spoilers` (absent: false, so a write queued before this release still applies).
create or replace function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member  uuid := auth.uid();
  v_today   date := (now() at time zone 'utc')::date;
  v_args    jsonb := coalesce(p_args, '{}'::jsonb);
  v_result  jsonb := '{}'::jsonb;
  v_entry   public.library_entries;
  v_session public.reading_sessions;
  v_day     date;
  v_mine    uuid;
  v_first   uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_invalid' using errcode = '22023';
  end if;

  -- Claimed first: a second send of the same write waits here until the first
  -- commits (and then answers from it) or rolls back (and then applies it).
  insert into public.synced_writes (request_id, member_id, action)
  values (p_request_id, v_member, p_action)
  on conflict (request_id) do nothing;
  if not found then
    select member_id, result into v_mine, v_result from public.synced_writes where request_id = p_request_id;
    if v_mine is distinct from v_member then
      raise exception 'request_invalid' using errcode = '22023';
    end if;
    return jsonb_build_object('replayed', true) || v_result;
  end if;

  case p_action
    when 'add_to_library' then
      select * into v_entry from public.add_to_library(
        p_book       => v_args -> 'p_book',
        p_status     => coalesce((v_args ->> 'p_status')::public.entry_status, 'want_to_read'),
        p_started_on => (v_args ->> 'p_started_on')::date,
        p_ended_on   => (v_args ->> 'p_ended_on')::date,
        p_rating     => (v_args ->> 'p_rating')::integer,
        p_review     => v_args ->> 'p_review',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
      );
      select s.id into v_first from public.latest_session(v_entry) s;
      v_result := jsonb_strip_nulls(jsonb_build_object('entry_id', v_entry.id, 'session_id', v_first));

    when 'start_reading' then
      select * into v_session from public.start_reading(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'read_again' then
      select * into v_session from public.read_again(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_started_on => (v_args ->> 'p_started_on')::date
      );
      v_result := jsonb_build_object('entry_id', v_session.entry_id, 'session_id', v_session.id);

    when 'finish_reading' then
      perform public.finish_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_rating   => (v_args ->> 'p_rating')::integer,
        p_review   => v_args ->> 'p_review',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
      );

    when 'abandon_reading' then
      perform public.abandon_reading(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_ended_on => (v_args ->> 'p_ended_on')::date,
        p_reason   => v_args ->> 'p_reason'
      );

    when 'update_progress' then
      -- The member's day, moved into the window when the write waited longer (see above).
      v_day := (v_args ->> 'p_day')::date;
      if v_day < v_today - 1 then
        v_day := v_today - 1;
      end if;
      perform public.update_progress(
        p_entry_id       => (v_args ->> 'p_entry_id')::uuid,
        p_page           => (v_args ->> 'p_page')::integer,
        p_percent        => (v_args ->> 'p_percent')::integer,
        p_set_page_count => coalesce((v_args ->> 'p_set_page_count')::boolean, false),
        p_page_count     => (v_args ->> 'p_page_count')::integer,
        p_day            => v_day,
        p_clear          => coalesce((v_args ->> 'p_clear')::boolean, false)
      );

    when 'update_session' then
      perform public.update_session(
        p_session_id     => (v_args ->> 'p_session_id')::uuid,
        p_started_on     => (v_args ->> 'p_started_on')::date,
        p_ended_on       => (v_args ->> 'p_ended_on')::date,
        p_rating         => (v_args ->> 'p_rating')::integer,
        p_review         => v_args ->> 'p_review',
        p_abandon_reason => v_args ->> 'p_abandon_reason',
        p_review_spoilers => coalesce((v_args ->> 'p_review_spoilers')::boolean, false)
      );

    when 'remove_from_library' then
      perform public.remove_from_library(p_entry_id => (v_args ->> 'p_entry_id')::uuid);

    when 'add_to_collection' then
      select * into v_entry from public.add_to_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_book       => v_args -> 'p_book'
      );
      v_result := jsonb_build_object('entry_id', v_entry.id);

    when 'remove_from_collection' then
      perform public.remove_from_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entry      => (v_args ->> 'p_entry')::uuid
      );

    when 'reorder_collection' then
      perform public.reorder_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_entries    => array(select jsonb_array_elements_text(v_args -> 'p_entries')::uuid)
      );

    when 'rename_collection' then
      perform public.rename_collection(
        p_collection => (v_args ->> 'p_collection')::uuid,
        p_name       => v_args ->> 'p_name'
      );

    when 'delete_collection' then
      perform public.delete_collection(p_collection => (v_args ->> 'p_collection')::uuid);

    when 'save_reader_highlight' then
      perform public.save_reader_highlight(
        p_id            => (v_args ->> 'p_id')::uuid,
        p_entry_id      => (v_args ->> 'p_entry_id')::uuid,
        p_file_hash     => v_args ->> 'p_file_hash',
        p_cfi           => v_args ->> 'p_cfi',
        p_section_index => (v_args ->> 'p_section_index')::integer,
        p_color         => v_args ->> 'p_color',
        p_excerpt       => v_args ->> 'p_excerpt',
        p_note          => v_args ->> 'p_note',
        p_deleted       => coalesce((v_args ->> 'p_deleted')::boolean, false),
        p_at            => (v_args ->> 'p_at')::timestamptz,
        p_created_at    => (v_args ->> 'p_created_at')::timestamptz
      );

    when 'set_entry_hidden' then
      perform public.set_entry_hidden(
        p_entry  => (v_args ->> 'p_entry')::uuid,
        p_hidden => (v_args ->> 'p_hidden')::boolean
      );

    else
      raise exception 'action_invalid' using errcode = '22023';
  end case;

  update public.synced_writes set result = v_result where request_id = p_request_id;
  -- Housekeeping: her own old rows, a handful at most.
  delete from public.synced_writes where member_id = v_member and synced_at < now() - interval '60 days';
  return jsonb_build_object('replayed', false) || v_result;
end;
$$;

comment on function public.sync_write(uuid, text, jsonb) is
  'Applies a write the device queued offline (issue #93) through the same function the online '
  'call uses, at most once per p_request_id: a second send answers with the first result. '
  'Also takes the reader''s highlights (save_reader_highlight, issue #131), hiding a Book '
  '(set_entry_hidden, social v1) and the review''s spoiler flag (social v2a).';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;

-- ------------------------------------------------------------------ helpers

-- The member has a finished read of this Book or of another edition of it (same non-null work key).
create or replace function private.finished_same_book(p_member uuid, p_book uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_member is not null and exists (
    select 1
      from public.library_entries e
      join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
      join public.books b on b.id = e.book_id
      join public.books w on w.id = p_book
     where e.member_id = p_member
       and (b.id = w.id
            or (w.openlibrary_work_key is not null and b.openlibrary_work_key = w.openlibrary_work_key))
  )
$$;

-- A review the author flagged is folded for everyone but her who has no finished read of the same
-- Book; no caller (a visitor of a reading page) always folds.
create or replace function private.review_folded(p_caller uuid, p_owner uuid, p_book uuid, p_spoilers boolean)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select coalesce(p_spoilers, false)
     and p_caller is distinct from p_owner
     and not private.finished_same_book(p_caller, p_book)
$$;

-- May the liker like (and be counted on) the owner's finished reads: she sees them (accepted
-- follower of a private account, anyone for a public one, no block) and her finished section is on.
create or replace function private.like_allowed(p_liker uuid, p_owner uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select private.visible(p_liker, p_owner) and (private.social_of(p_owner)).show_finished
$$;

-- The likes of a finished read that the database still allows, set-based: the owner's side is looked at
-- once (her finished section is on, the Book is not hidden, her account's private flag), the likers'
-- side by joins (not herself, no block either way, and for a private account an accepted follow). The
-- same answer as `like_allowed` liker by liker (visible = reachable and, for a private account, an
-- accepted follow; a public account is reachable by anyone not blocked), without its queries per like.
create or replace function private.allowed_likes(p_session uuid)
returns setof public.likes
language sql
stable
set search_path = pg_catalog, public, private
as $$
  with o as (
    select e.member_id as owner, so.private
      from public.reading_sessions s
      join public.library_entries e on e.id = s.entry_id and not e.hidden
      cross join lateral private.social_of(e.member_id) so
     where s.id = p_session and s.outcome = 'finished' and so.show_finished
  )
  select l.*
    from public.likes l
    cross join o
   where l.session_id = p_session
     and l.member_id <> o.owner
     and not exists (select 1 from public.blocks b
                      where (b.blocker_id = l.member_id and b.blocked_id = o.owner)
                         or (b.blocker_id = o.owner and b.blocked_id = l.member_id))
     and (not o.private
          or exists (select 1 from public.follows f
                      where f.follower_id = l.member_id and f.followee_id = o.owner and f.accepted_at is not null))
$$;

-- The likes of a finished read that the database still allows; none while its Book is hidden.
create or replace function private.like_count(p_session uuid)
returns integer
language sql
stable
set search_path = pg_catalog, public, private
as $$
  select count(*)::integer from private.allowed_likes(p_session)
$$;

create or replace function private.liked_by(p_member uuid, p_session uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select p_member is not null
     and exists (select 1 from public.likes where member_id = p_member and session_id = p_session)
$$;

-- A follow ends (unfollow, remove follower, block, …): the likes the follower gave on the other's
-- reads go with it. (A public account keeps strangers' likes: no follow, no row.)
create or replace function private.likes_on_follow_end()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.likes l
   using public.reading_sessions s, public.library_entries e
   where l.member_id = old.follower_id
     and s.id = l.session_id
     and e.id = s.entry_id
     and e.member_id = old.followee_id;
  return old;
end;
$$;

-- A block: the likes either gave on the other's reads go, strangers' on a public account too.
create or replace function private.likes_on_block()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.likes l
   using public.reading_sessions s, public.library_entries e
   where s.id = l.session_id
     and e.id = s.entry_id
     and ((l.member_id = new.blocker_id and e.member_id = new.blocked_id)
       or (l.member_id = new.blocked_id and e.member_id = new.blocker_id));
  return new;
end;
$$;

drop trigger if exists follows_likes_on_end on public.follows;
create trigger follows_likes_on_end
  after delete on public.follows
  for each row execute function private.likes_on_follow_end();
drop trigger if exists blocks_likes_on_block on public.blocks;
create trigger blocks_likes_on_block
  after insert on public.blocks
  for each row execute function private.likes_on_block();

revoke all on function private.finished_same_book(uuid, uuid) from public, anon, authenticated;
revoke all on function private.review_folded(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.like_allowed(uuid, uuid) from public, anon, authenticated;
revoke all on function private.allowed_likes(uuid) from public, anon, authenticated;
revoke all on function private.like_count(uuid) from public, anon, authenticated;
revoke all on function private.liked_by(uuid, uuid) from public, anon, authenticated;
revoke all on function private.likes_on_follow_end() from public, anon, authenticated;
revoke all on function private.likes_on_block() from public, anon, authenticated;

-- ------------------------------------------------------------ 1.1, 1.2 the readers

-- feed: the latest (20261017060000_social_gate2.sql) plus sessionId, spoilers, folded, likes, liked.
create or replace function public.feed(
  p_before    timestamptz default null,
  p_before_id uuid default null,
  p_limit     integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller uuid := auth.uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', t.id,
             'at', t.visible_at,
             'member', private.member_card(v_caller, t.member_id),
             'kind', t.kind,
             'again', t.again,
             'day', t.on_day,
             'book', private.social_book_json(b),
             'rating', t.rating,
             'review', t.review,
             'sessionId', case when t.kind in ('finished', 'reviewed') then t.session_id end,
             'spoilers', coalesce(t.review is not null and t.review_spoilers, false),
             'folded', coalesce(t.review is not null
                                and private.review_folded(v_caller, t.member_id, t.book_id, t.review_spoilers), false),
             'likes', case when t.kind in ('finished', 'reviewed') then private.like_count(t.session_id) else 0 end,
             'liked', case when t.kind in ('finished', 'reviewed')
                           then private.liked_by(v_caller, t.session_id) else false end
           ) order by t.visible_at desc, t.id desc), '[]'::jsonb)
    into v_out
    from (
      select a.id, a.member_id, a.kind, a.on_day, a.visible_at, a.entry_id,
             case when a.kind in ('finished', 'reviewed') and coalesce(f.show_ratings, true)
                  then rs.rating end as rating,
             case when a.kind in ('finished', 'reviewed') and coalesce(f.show_reviews, true)
                  then rs.review end as review,
             (a.kind = 'started' and coalesce(f.show_finished, true) and exists (
                select 1 from public.reading_sessions p
                 where p.entry_id = a.entry_id
                   and p.outcome = 'finished'
                   and p.id is distinct from a.session_id
                   and coalesce(p.ended_on, p.created_at::date)
                       <= coalesce(rs.started_on, rs.created_at::date)
             )) as again,
             e.book_id, a.session_id, rs.review_spoilers
        from (
          select fo.followee_id,
                 s.show_reading, s.show_want, s.show_finished, s.show_ratings,
                 s.show_reviews, s.show_abandoned
            from public.follows fo
            left join public.social_settings s on s.member_id = fo.followee_id
           where fo.follower_id = v_caller
             and fo.accepted_at is not null
             and not private.blocked_either(v_caller, fo.followee_id)
        ) f
        cross join lateral (
          select a.*
            from public.activity a
            join public.library_entries e on e.id = a.entry_id and not e.hidden
           where a.member_id = f.followee_id
             and a.visible_at <= now()
             and (p_before is null
                  or a.visible_at < p_before
                  or (p_before_id is not null and a.visible_at = p_before and a.id < p_before_id))
             and case a.kind
                   when 'started'   then coalesce(f.show_reading, true)
                   when 'want'      then coalesce(f.show_want, true)
                   when 'finished'  then coalesce(f.show_finished, true)
                   when 'abandoned' then coalesce(f.show_abandoned, true)
                   when 'reviewed'  then coalesce(f.show_reviews, true) and coalesce(f.show_finished, true)
                                         -- and a review that is still there (4. below)
                                         and exists (select 1 from public.reading_sessions r
                                                      where r.id = a.session_id
                                                        and nullif(btrim(r.review), '') is not null)
                   else false
                 end
           order by a.visible_at desc, a.id desc
           limit v_limit
        ) a
        join public.library_entries e on e.id = a.entry_id
        left join public.reading_sessions rs on rs.id = a.session_id
       order by a.visible_at desc, a.id desc
       limit v_limit
    ) t
    join public.books b on b.id = t.book_id;

  return v_out;
end;
$$;
-- member_profile: the latest (20261017040000_social_readers.sql) plus the same on its finished rows.
create or replace function public.member_profile(p_member uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_caller   uuid := auth.uid();
  v_s        public.social_settings;
  v_follow   public.follows;
  v_state    text;
  v_card     jsonb;
  v_since    date;
  v_read     bigint;
  v_reading  bigint;
  v_want     bigint;
  v_readings jsonb := '[]'::jsonb;
  v_wants    jsonb := '[]'::jsonb;
  v_finished jsonb := '[]'::jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.reachable(v_caller, p_member) then
    return null;
  end if;

  v_s := private.social_of(p_member);
  v_card := private.member_card(v_caller, p_member);

  select * into v_follow from public.follows
   where follower_id = v_caller and followee_id = p_member;
  v_state := case
    when not found then 'none'
    when v_follow.accepted_at is not null then 'following'
    else 'requested'              -- asked, or declined: the asker cannot tell
  end;

  if not private.visible(v_caller, p_member) then
    return jsonb_build_object('member', v_card, 'private', v_s.private, 'state', v_state, 'visible', false);
  end if;

  -- The earliest start or end of a closed read she shows (an off section shows no date either).
  select min(least(s.started_on, s.ended_on)) into v_since
    from public.library_entries e
    join public.reading_sessions s on s.entry_id = e.id
   where e.member_id = p_member and not e.hidden
     and ((s.outcome = 'finished' and v_s.show_finished)
          or (s.outcome = 'abandoned' and v_s.show_abandoned));

  if v_s.show_finished then
    select count(*) into v_read
      from public.library_entries e
     where e.member_id = p_member and not e.hidden
       and exists (select 1 from public.reading_sessions s
                    where s.entry_id = e.id and s.outcome = 'finished');

    select coalesce(jsonb_agg(
             jsonb_build_object(
               'book', private.social_book_json(b),
               'endedOn', f.ended_on,
               'rating', case when v_s.show_ratings then f.rating end,
               'review', case when v_s.show_reviews then f.review end,
               'sessionId', f.session_id,
               'spoilers', (v_s.show_reviews and f.review is not null and f.review_spoilers),
               'folded', (v_s.show_reviews and f.review is not null
                          and private.review_folded(v_caller, p_member, f.book_id, f.review_spoilers)),
               'likes', private.like_count(f.session_id),
               'liked', private.liked_by(v_caller, f.session_id)
             ) order by f.ended_on desc nulls last, f.created_at desc), '[]'::jsonb)
      into v_finished
      from (
        select x.* from (
          select distinct on (e.id) e.book_id, s.ended_on, s.rating, s.review, s.created_at,
                 s.id as session_id, s.review_spoilers
            from public.library_entries e
            join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
           where e.member_id = p_member and not e.hidden
           order by e.id, s.ended_on desc nulls last, s.created_at desc
        ) x
        order by x.ended_on desc nulls last, x.created_at desc
        limit 12
      ) f
      join public.books b on b.id = f.book_id;
  end if;

  if v_s.show_reading then
    select count(*) into v_reading
      from public.library_entries e
     where e.member_id = p_member and not e.hidden
       and exists (select 1 from public.reading_sessions s
                    where s.entry_id = e.id and s.outcome is null);

    select coalesce(jsonb_agg(
             jsonb_build_object('book', private.social_book_json(b), 'startedOn', r.started_on)
             order by r.started_on desc nulls last, r.created_at desc), '[]'::jsonb)
      into v_readings
      from (
        select e.book_id, s.started_on, s.created_at
          from public.library_entries e
          join public.reading_sessions s on s.entry_id = e.id and s.outcome is null
         where e.member_id = p_member and not e.hidden
         order by s.started_on desc nulls last, s.created_at desc
         limit 6
      ) r
      join public.books b on b.id = r.book_id;
  end if;

  if v_s.show_want then
    select count(*) into v_want
      from public.library_entries e
     where e.member_id = p_member and not e.hidden and e.status = 'want_to_read';

    select coalesce(jsonb_agg(
             jsonb_build_object('book', private.social_book_json(b), 'addedOn', w.added_at::date)
             order by w.added_at desc, w.id desc), '[]'::jsonb)
      into v_wants
      from (
        select e.id, e.book_id, e.added_at
          from public.library_entries e
         where e.member_id = p_member and not e.hidden and e.status = 'want_to_read'
         order by e.added_at desc, e.id desc
         limit 12
      ) w
      join public.books b on b.id = w.book_id;
  end if;

  return jsonb_build_object(
    'member', v_card,
    'private', v_s.private,
    'state', v_state,
    'visible', true,
    'followsYou', exists (select 1 from public.follows
                           where follower_id = p_member and followee_id = v_caller
                             and accepted_at is not null),
    'sections', jsonb_build_object(
      'reading', v_s.show_reading, 'want', v_s.show_want, 'finished', v_s.show_finished,
      'ratings', v_s.show_ratings, 'reviews', v_s.show_reviews, 'abandoned', v_s.show_abandoned,
      'year', v_s.show_year),
    'since', v_since,
    'counts', jsonb_build_object('read', v_read, 'reading', v_reading, 'want', v_want),
    'reading', v_readings,
    'want', v_wants,
    'finished', v_finished
  );
end;
$$;

-- reading_page_finished: as 20261011030000_reading_pages.sql has it, plus the review's spoiler flag.
drop function if exists private.reading_page_finished(uuid, integer);
create function private.reading_page_finished(p_member uuid, p_limit integer)
returns table (book_id uuid, ended_on date, rating smallint, review text, review_spoilers boolean)
language sql
stable
set search_path = pg_catalog, public
as $$
  select book_id, ended_on, rating, review, review_spoilers from (
    select distinct on (r.book_id) r.book_id, r.ended_on, r.rating, r.review, r.created_at,
           (select s.review_spoilers from public.reading_sessions s where s.id = r.session_id) as review_spoilers
      from private.reading_page_reads(p_member) r
     order by r.book_id, r.ended_on desc nulls last, r.created_at desc
  ) latest
  order by ended_on desc nulls last, created_at desc
  limit p_limit
$$;
revoke all on function private.reading_page_finished(uuid, integer) from public, anon, authenticated;

-- public_reading_page: as 20261011030000_reading_pages.sql has it, finished rows with spoilers and folded
-- (a visitor without a sign-in always gets a spoiler review folded).
create or replace function public.public_reading_page(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_page   public.reading_pages;
  v_result jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;

  v_result := jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'sections', jsonb_build_object(
      'reading', v_page.show_reading, 'year', v_page.show_year, 'favourites', v_page.show_favourites,
      'finished', v_page.show_finished, 'shelf', v_page.show_shelf));

  if v_page.show_reading then
    v_result := v_result || jsonb_build_object('reading', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'started_on', r.started_on)
                                order by r.started_on desc nulls last), '[]'::jsonb)
        from private.reading_page_reading(v_page.member_id) r join public.books b on b.id = r.book_id));
  end if;

  if v_page.show_year then
    v_result := v_result || jsonb_build_object('year', private.reading_page_year(v_page.member_id));
  end if;

  if v_page.show_favourites then
    v_result := v_result || jsonb_build_object('favourites', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'rating', f.rating)
                                order by f.rating desc, f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_favourites(v_page.member_id) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_finished then
    v_result := v_result || jsonb_build_object('finished', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'book', private.reading_page_book_json(b), 'ended_on', f.ended_on, 'rating', f.rating,
               'review', private.reading_page_review(v_page.member_id, f.book_id, f.review),
               'spoilers', coalesce(private.reading_page_review(v_page.member_id, f.book_id, f.review) is not null
                                    and f.review_spoilers, false),
               'folded', coalesce(private.reading_page_review(v_page.member_id, f.book_id, f.review) is not null
                                  and private.review_folded(auth.uid(), v_page.member_id, f.book_id, f.review_spoilers), false))
             order by f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_finished(v_page.member_id, 12) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_shelf then
    if private.reading_page_has_regal(v_page.member_id) then
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'regal'));
    else
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'covers', 'books', (
        select coalesce(jsonb_agg(private.reading_page_book_json(b) order by f.ended_on desc nulls last), '[]'::jsonb)
          from private.reading_page_finished(v_page.member_id, 60) f join public.books b on b.id = f.book_id)));
    end if;
  end if;

  return v_result;
end;
$$;

-- public_book_card: as 20261017050000_social_hardening.sql has it, plus spoilers and folded.
create or replace function public.public_book_card(p_token text, p_book uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_page   public.reading_pages;
  v_entry  public.library_entries;
  v_book   public.books;
  v_ended  date;
  v_rating smallint;
  v_review text;
  v_spoilers boolean;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' or p_book is null then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;
  select * into v_entry from public.library_entries where member_id = v_page.member_id and book_id = p_book and not hidden;
  if not found then
    return null;
  end if;
  if not exists (select 1 from public.reading_page_books where member_id = v_page.member_id and book_id = p_book)
     and p_book not in (select private.reading_page_shown_books(v_page)) then
    return null;
  end if;

  select * into v_book from public.books where id = p_book;
  select r.ended_on, r.rating, r.review,
         (select s.review_spoilers from public.reading_sessions s where s.id = r.session_id)
    into v_ended, v_rating, v_review, v_spoilers
    from private.reading_page_reads(v_page.member_id) r
   where r.book_id = p_book
   order by r.ended_on desc nulls last, r.created_at desc
   limit 1;

  return jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'book', private.reading_page_book_json(v_book),
    'status', v_entry.status,
    'ended_on', v_ended,
    'rating', v_rating,
    'review', private.reading_page_review(v_page.member_id, p_book, v_review),
    'spoilers', coalesce(private.reading_page_review(v_page.member_id, p_book, v_review) is not null
                         and v_spoilers, false),
    'folded', coalesce(private.reading_page_review(v_page.member_id, p_book, v_review) is not null
                       and private.review_folded(auth.uid(), v_page.member_id, p_book, v_spoilers), false));
end;
$$;

revoke all on function public.public_reading_page(text) from public;
revoke all on function public.public_book_card(text, uuid) from public;
grant execute on function public.public_reading_page(text) to anon, authenticated;
grant execute on function public.public_book_card(text, uuid) to anon, authenticated;

revoke all on function public.feed(timestamptz, uuid, integer) from public, anon;
revoke all on function public.member_profile(uuid) from public, anon;
grant execute on function public.feed(timestamptz, uuid, integer) to authenticated;
grant execute on function public.member_profile(uuid) to authenticated;

-- ------------------------------------------------------------------ 1.2 likes

-- Like a finished read. The caller must be able to see it; not her own; else `not_found` (the same
-- answer for a read that does not exist). Idempotent. 300 new likes an hour (`rate_limited`).
create or replace function public."like"(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select e.member_id into v_owner
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id and not e.hidden
   where s.id = p_session and s.outcome = 'finished';
  if v_owner is null or private.like_allowed(v_caller, v_owner) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  -- The pair's lock (the one follow and block take), and the follow row held `for share` before the
  -- look below: an unfollow waits for this like and then takes it away with its trigger, and one that
  -- committed first is seen by the look. A block cannot slip in between either.
  perform pg_advisory_xact_lock(hashtextextended(
    'pair:' || least(v_caller, v_owner)::text || greatest(v_caller, v_owner)::text, 0));
  perform 1 from public.follows where follower_id = v_caller and followee_id = v_owner for share;
  if not exists (select 1 from public.reading_sessions s
                   join public.library_entries e on e.id = s.entry_id and not e.hidden
                  where s.id = p_session and s.outcome = 'finished' and e.member_id = v_owner)
     or private.like_allowed(v_caller, v_owner) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  if not exists (select 1 from public.likes where member_id = v_caller and session_id = p_session) then
    -- One call at a time per member, so that parallel calls cannot slip past the limit.
    perform pg_advisory_xact_lock(hashtextextended('like:' || v_caller::text, 0));
    if (select count(*) from private.like_calls
         where member_id = v_caller and at > now() - interval '1 hour') >= 300 then
      raise exception 'rate_limited' using errcode = 'PT429';
    end if;
    delete from private.like_calls where member_id = v_caller and at < now() - interval '1 day';
    insert into private.like_calls (member_id) values (v_caller);
    insert into public.likes (member_id, session_id) values (v_caller, p_session)
    on conflict do nothing;
  end if;

  return jsonb_build_object('likes', private.like_count(p_session), 'liked', true);
end;
$$;

-- Take a like back: the same refusals as like (a read she cannot see is not found), idempotent.
create or replace function public.unlike(p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select e.member_id into v_owner
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id and not e.hidden
   where s.id = p_session and s.outcome = 'finished';
  if v_owner is null or private.like_allowed(v_caller, v_owner) is not true then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  delete from public.likes where member_id = v_caller and session_id = p_session;
  return jsonb_build_object('likes', private.like_count(p_session), 'liked', false);
end;
$$;

-- Who liked her read: only the author (anyone else: not_found, as for an unknown read); newest
-- first, as cards. A hidden Book lists nobody.
create or replace function public.session_likers(p_session uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_hidden boolean;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select e.hidden into v_hidden
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id
   where s.id = p_session and s.outcome = 'finished' and e.member_id = v_caller;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_hidden then
    return '[]'::jsonb;
  end if;

  return (select coalesce(jsonb_agg(private.member_card(v_caller, l.member_id)
                                    order by l.created_at desc, l.member_id), '[]'::jsonb)
            from private.allowed_likes(p_session) l);
end;
$$;

-- Home's "Your circle": her reads that were liked in the last 7 days, newest like first, at most
-- 5: [{ session, book, likers (the 3 newest, as cards), count (all likes still allowed), at (the
-- newest like) }].
create or replace function public.my_recent_likes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'session', g.session_id,
             'book', private.social_book_json(b),
             'likers', (select coalesce(jsonb_agg(private.member_card(v_caller, x.member_id)
                                                  order by x.created_at desc, x.member_id), '[]'::jsonb)
                          from (select l2.member_id, l2.created_at
                                  from private.allowed_likes(g.session_id) l2
                                 order by l2.created_at desc, l2.member_id
                                 limit 3) x),
             'count', g.cnt,
             'at', g.at) order by g.at desc, g.session_id), '[]'::jsonb)
      from (
        select c.session_id, c.book_id, max(a.created_at) as at, count(*)::integer as cnt
          from (
            -- Her finished reads, not hidden, with a like in the last week: cut before anything is
            -- asked of the likers.
            select s.id as session_id, e.book_id
              from public.reading_sessions s
              join public.library_entries e on e.id = s.entry_id and e.member_id = v_caller and not e.hidden
             where s.outcome = 'finished'
               and exists (select 1 from public.likes l
                            where l.session_id = s.id and l.created_at > now() - interval '7 days')
          ) c
          cross join lateral private.allowed_likes(c.session_id) a
         group by c.session_id, c.book_id
        having max(a.created_at) > now() - interval '7 days'
         order by max(a.created_at) desc, c.session_id
         limit 5
      ) g
      join public.books b on b.id = g.book_id
  );
end;
$$;

-- ------------------------------------------------------------------ 1.3 you both read

-- The Books both finished, newest of hers first: { book (her edition), mine: { rating, endedOn },
-- hers: { rating (null without show_ratings), endedOn } }. Only where her finished reads are
-- visible to the caller, as `member_reading_record` has them (visible, and both show_finished and
-- show_year: the list is every shared Book, past the profile's twelve); otherwise, and for herself, `[]`. Mine is my latest finished read of the same Book.
create or replace function public.both_read(p_member uuid, p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_s      public.social_settings;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if private.visible(v_caller, p_member) is not true then
    return '[]'::jsonb;
  end if;
  v_s := private.social_of(p_member);
  if not v_s.show_finished or not v_s.show_year then
    return '[]'::jsonb;
  end if;

  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'book', private.social_book_json(b),
             'mine', jsonb_build_object('rating', m.rating, 'endedOn', m.ended_on),
             'hers', jsonb_build_object('rating', case when v_s.show_ratings then h.rating end,
                                        'endedOn', h.ended_on))
           order by h.ended_on desc nulls last, h.created_at desc, b.id), '[]'::jsonb)
      from (
        select distinct on (e.id) e.book_id, s.rating, s.ended_on, s.created_at
          from public.library_entries e
          join public.reading_sessions s on s.entry_id = e.id and s.outcome = 'finished'
         where e.member_id = p_member and not e.hidden
           and (p_year is null or extract(year from s.ended_on) = p_year)
         order by e.id, s.ended_on desc nulls last, s.created_at desc
      ) h
      join public.books b on b.id = h.book_id
      cross join lateral (
        select s2.rating, s2.ended_on
          from public.library_entries e2
          join public.reading_sessions s2 on s2.entry_id = e2.id and s2.outcome = 'finished'
          join public.books b2 on b2.id = e2.book_id
         where e2.member_id = v_caller
           and (b2.id = b.id
                or (b.openlibrary_work_key is not null and b2.openlibrary_work_key = b.openlibrary_work_key))
         order by s2.ended_on desc nulls last, s2.created_at desc
         limit 1
      ) m
  );
end;
$$;

-- ------------------------------------------------------------------ 1.4 the same book now

-- For each of her Books given (at most 50; her open reads, or her Want to read): the members she
-- follows (accepted, not blocked either way, the switch on, the entry not hidden) who have an open
-- read, or want to read, the same Book. [{ book (hers), members (cards, at most 3, newest entry
-- first), more }]; a Book nobody shares is left out.
create or replace function private.circle_of(p_caller uuid, p_books uuid[], p_reading boolean)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with mine as (
    select distinct b.id as book_id, b.openlibrary_work_key as wk
      from unnest((coalesce(p_books, '{}'::uuid[]))[1:50]) as u(id)
      join public.books b on b.id = u.id
      join public.library_entries e on e.book_id = b.id and e.member_id = p_caller
     where case when p_reading
                then exists (select 1 from public.reading_sessions s where s.entry_id = e.id and s.outcome is null)
                else e.status = 'want_to_read' end
  ), hers as (
    select distinct on (m.book_id, e.member_id) m.book_id, e.member_id, e.added_at, e.id as entry_id
      from mine m
      join public.books b2 on b2.id = m.book_id
                          or (m.wk is not null and b2.openlibrary_work_key = m.wk)
      join public.library_entries e on e.book_id = b2.id and not e.hidden and e.member_id <> p_caller
      join public.follows f on f.follower_id = p_caller and f.followee_id = e.member_id
                           and f.accepted_at is not null
      left join public.social_settings st on st.member_id = e.member_id
     where case when p_reading
                then coalesce(st.show_reading, true)
                     and exists (select 1 from public.reading_sessions s where s.entry_id = e.id and s.outcome is null)
                else coalesce(st.show_want, true) and e.status = 'want_to_read' end
       and not private.blocked_either(p_caller, e.member_id)
     order by m.book_id, e.member_id, e.added_at desc, e.id
  ), ranked as (
    select h.book_id, h.member_id,
           row_number() over (partition by h.book_id order by h.added_at desc, h.entry_id, h.member_id) as rn,
           count(*) over (partition by h.book_id) as total
      from hers h
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'book', g.book_id, 'members', g.members, 'more', greatest(g.total - 3, 0)
         ) order by g.book_id), '[]'::jsonb)
    from (
      select r.book_id, max(r.total)::integer as total,
             jsonb_agg(private.member_card(p_caller, r.member_id) order by r.rn) filter (where r.rn <= 3) as members
        from ranked r
       group by r.book_id
    ) g
$$;

create or replace function public.circle_reading(p_books uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return private.circle_of(v_caller, p_books, true);
end;
$$;

create or replace function public.circle_want(p_books uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  return private.circle_of(v_caller, p_books, false);
end;
$$;

-- ------------------------------------------------------------------ going private

-- set_private: the latest (20261017050000_social_hardening.sql), and a member who goes private takes
-- back what strangers gave her: the likes on her reads by members who are not her accepted followers
-- (a public account's strangers; a public, private, public again must not bring them back).
create or replace function public.set_private(p_private boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.social_ensure(v_member);
  update public.social_settings
     set private = coalesce(p_private, private), updated_at = now()
   where member_id = v_member;
  if p_private is false then
    update public.follows
       set accepted_at = now()
     where followee_id = v_member and accepted_at is null and declined_at is null;
    -- A declined request does not survive: it would be the only "requested" left on a public
    -- account, and so tell the asker he was declined.
    delete from public.follows
     where followee_id = v_member and accepted_at is null and declined_at is not null;
  elsif p_private is true then
    delete from public.likes l
     using public.reading_sessions s, public.library_entries e
     where s.id = l.session_id
       and e.id = s.entry_id
       and e.member_id = v_member
       and not exists (select 1 from public.follows f
                        where f.follower_id = l.member_id and f.followee_id = v_member and f.accepted_at is not null);
  end if;
  return private.my_social_json(v_member);
end;
$$;

revoke all on function public.set_private(boolean) from public, anon;
grant execute on function public.set_private(boolean) to authenticated;

-- ------------------------------------------------------------------ grants

revoke all on function private.circle_of(uuid, uuid[], boolean) from public, anon, authenticated;
revoke all on function public."like"(uuid) from public, anon;
revoke all on function public.unlike(uuid) from public, anon;
revoke all on function public.session_likers(uuid) from public, anon;
revoke all on function public.my_recent_likes() from public, anon;
revoke all on function public.both_read(uuid, integer) from public, anon;
revoke all on function public.circle_reading(uuid[]) from public, anon;
revoke all on function public.circle_want(uuid[]) from public, anon;
grant execute on function public."like"(uuid) to authenticated;
grant execute on function public.unlike(uuid) to authenticated;
grant execute on function public.session_likers(uuid) to authenticated;
grant execute on function public.my_recent_likes() to authenticated;
grant execute on function public.both_read(uuid, integer) to authenticated;
grant execute on function public.circle_reading(uuid[]) to authenticated;
grant execute on function public.circle_want(uuid[]) to authenticated;
