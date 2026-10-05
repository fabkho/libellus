-- Save offline, sync later (issue #93).
--
-- A write made without a connection waits on the device (web/app/data/outbox.ts)
-- and is sent once the connection is back, in the order it was made. Sending it
-- may happen twice: the call reaches the database, the answer is lost on the way
-- back (the train enters a tunnel) and the device, which never heard "done",
-- sends it again. Most writes would then be refused the second time
-- (`already_reading`, `not_reading`, `already_in_library`) or, worse, applied
-- twice. So a write that waited goes through `sync_write`, carrying the id the
-- device gave it when it was made (`p_request_id`):
--
--   synced_writes        one row per write that was applied
--     request_id         the device's id for the write (a v4 UUID)
--     member_id          whose it is
--     action             which function it called
--     result             what the device needs to know afterwards: the ids of
--                        rows the write made (`entry_id`, `session_id`), so a
--                        write that waited behind it can name them
--     synced_at          when
--
-- `sync_write` calls the same function the online path calls (`update_progress`,
-- `start_reading`, … with the same arguments, by name) and records the id in the
-- same transaction. The second time it finds the id and answers with the first
-- result, changing nothing (`replayed: true`). A refusal raises as the function
-- raised it and records nothing: the write was never applied, and sending it again
-- is refused again. Two sends at once (two tabs) wait on each other's row; the
-- second sees the first's result.
--
-- Only the writes the device may queue are accepted (the list is in
-- docs/parity.md, Save offline and sync later): those that name rows the member
-- already has. Search, imports, Goodreads, Change edition, deleting a read and
-- making a Collection stay online-only and are not callable here.
--
-- One rule differs from the online call: `update_progress` books the member's day
-- (`p_day`) only within a day of the server's UTC date (#68). A progress update
-- that waited longer than that would be refused for its day alone, so a day
-- older than the window is booked on the window's first day instead. The value
-- itself is kept exactly.
--
-- The rows are the member's own and nobody reads them directly (RLS on, no policy,
-- no grants): only `sync_write` (security definer) writes and reads them. A
-- member's rows older than 60 days are dropped as she syncs: a write never waits
-- that long on a device that is used.

create table public.synced_writes (
  request_id uuid primary key,
  member_id  uuid not null references auth.users (id) on delete cascade,
  action     text not null,
  result     jsonb not null default '{}'::jsonb,
  synced_at  timestamptz not null default now()
);

create index synced_writes_member_synced_at on public.synced_writes (member_id, synced_at);

comment on table public.synced_writes is
  'Writes a device queued offline and synced later (issue #93), by the id the device gave them: '
  'a second send of the same write is answered from here instead of applied again. Written only by sync_write.';

alter table public.synced_writes enable row level security;
revoke all on public.synced_writes from public, anon, authenticated;

create function public.sync_write(p_request_id uuid, p_action text, p_args jsonb)
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
        p_review     => v_args ->> 'p_review'
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
        p_review   => v_args ->> 'p_review'
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
        p_day            => v_day
      );

    when 'update_session' then
      perform public.update_session(
        p_session_id     => (v_args ->> 'p_session_id')::uuid,
        p_started_on     => (v_args ->> 'p_started_on')::date,
        p_ended_on       => (v_args ->> 'p_ended_on')::date,
        p_rating         => (v_args ->> 'p_rating')::integer,
        p_review         => v_args ->> 'p_review',
        p_abandon_reason => v_args ->> 'p_abandon_reason'
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
  'call uses, at most once per p_request_id: a second send answers with the first result.';

revoke all on function public.sync_write(uuid, text, jsonb) from public, anon;
grant execute on function public.sync_write(uuid, text, jsonb) to authenticated;
