-- The member's own page count on a read that is already finished (Profile,
-- the "N without a page count" line).
--
-- `library_entries.page_count_override` (issue #60: an ebook's pages follow the
-- font size) is so far only written through `update_progress`, and that one
-- refuses a finished entry (`not_reading`: the read's outcome is not null), so
-- a read that ended without a count could never get one. This narrow sibling
-- sets only the override, on any entry of hers including a finished one, on
-- purpose: the count she sets is hers to keep, even after she finished the
-- book, and she may change it again afterwards (the edition's count stays the
-- default underneath).
--
--   set_read_total(p_entry_id, p_page_count)
--
-- `p_page_count` is the new override, or null to go back to the edition's.
-- A total that only repeats the edition's page count is stored as no override
-- (as `update_progress` has it), so a later backfill can still supply the
-- truth. A total outside 1 … 99999 is `progress_invalid`, the same refusal
-- the neighbours use.
--
-- A lower total never rewrites recorded history: `reading_sessions` and
-- `reading_progress_days` are left exactly as they were, even when the new
-- total is below pages already recorded. History is what happened; the total
-- is only what future figures measure against. Do not "fix" this by clamping.
--
-- Additive only: one function, no table change, no row but the entry's own
-- override touched.

create function public.set_read_total(
  p_entry_id   uuid,
  p_page_count integer default null
)
returns public.library_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member     uuid := auth.uid();
  v_book_count integer;
  v_override   integer;
  v_entry      public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_page_count is not null and p_page_count not between 1 and 99999 then
    raise exception 'progress_invalid' using errcode = '22023';
  end if;

  -- Locked, so a progress update from another device lands one after the other.
  select b.page_count into v_book_count
    from public.library_entries e
    join public.books b on b.id = e.book_id
   where e.id = p_entry_id and e.member_id = v_member
     for update of e;
  if not found then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;

  -- A total that only repeats the edition's is no override.
  v_override := case when p_page_count is not distinct from v_book_count then null else p_page_count end;

  update public.library_entries set page_count_override = v_override where id = p_entry_id
  returning * into v_entry;
  return v_entry;
end;
$$;

revoke all on function public.set_read_total(uuid, integer) from public, anon;
grant execute on function public.set_read_total(uuid, integer) to authenticated;

-- ------------------------------------------------------------------ the outbox

--  may be queued offline (issue #93):  dispatches a waited write by its action
-- name, so it needs a branch of its own or a total set without a connection would replay into nothing. The
-- function body below is the one  left, unchanged but for the new
--  clause; an applied migration is never edited, so it is replaced here.

create or replace function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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

    when 'set_progress_day' then
      -- An earlier day as queued: not moved into update_progress's window (see above).
      perform public.set_progress_day(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_day      => (v_args ->> 'p_day')::date,
        p_page     => (v_args ->> 'p_page')::integer,
        p_percent  => (v_args ->> 'p_percent')::integer
      );

    when 'delete_progress_day' then
      perform public.delete_progress_day(
        p_entry_id => (v_args ->> 'p_entry_id')::uuid,
        p_day      => (v_args ->> 'p_day')::date
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

    when 'set_read_total' then
      -- Her own page count on an entry, a finished one included: the override only, never the edition's
      -- count and never recorded progress. A total that only repeats the edition's is stored as none.
      perform public.set_read_total(
        p_entry_id   => (v_args ->> 'p_entry_id')::uuid,
        p_page_count => (v_args ->> 'p_page_count')::integer
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
