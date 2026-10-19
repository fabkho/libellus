-- The holder 'job:<id>' belongs to the server import job (20261102010000_import_jobs.sql): its place in the queue is made by
-- the job's own functions and does not expire by the beat rule while the job lives. A device must not be able to take, beat
-- or leave a place under that name, so the three import_slot_* functions refuse it (holder_invalid, 22023).
--
-- The functions are the ones of 20261030020000_import_queue.sql (beat, leave) and 20261031010000_import_queue_device.sql (take),
-- whole; the one change is the refusal. Signatures and grants are unchanged.

create or replace function public.import_slot_take(p_holder text, p_rows integer default 0, p_device text default null)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 or p_holder like 'job:%' then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  if p_rows is null or p_rows not between 0 and 100000 then
    raise exception 'rows_invalid' using errcode = '22023';
  end if;
  if p_device is not null and char_length(p_device) not between 1 and 64 then
    raise exception 'device_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  -- Her one place: the same run asking again keeps it, and so does the same device in a new run (the app was
  -- closed and opened again): the place changes holder, keeping its turn and the slot. Another device is told it is taken.
  insert into public.import_queue as q (member_id, holder, rows, device)
  values (v_member, p_holder, p_rows, p_device)
  on conflict (member_id) do update
    set holder = excluded.holder, rows = excluded.rows, device = excluded.device, beat_at = clock_timestamp()
    where q.holder not like 'job:%'
      and (q.holder = excluded.holder or (excluded.device is not null and q.device = excluded.device));
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

create or replace function public.import_slot_beat(p_holder text, p_done integer default null)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 or p_holder like 'job:%' then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  -- Her own beat counts before the sweep: a beat that comes late but before anyone swept keeps the place.
  update public.import_queue
     set beat_at = clock_timestamp(), done = greatest(done, least(coalesce(p_done, done), rows))
   where member_id = v_member and holder = p_holder;
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

create or replace function public.import_slot_leave(p_holder text)
returns table (state text, mine boolean, ahead integer, rows_ahead integer)
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
begin
  if v_member is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if p_holder is null or char_length(p_holder) not between 1 and 64 or p_holder like 'job:%' then
    raise exception 'holder_invalid' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('import_queue'));
  perform private.import_slot_sweep();
  delete from public.import_queue where member_id = v_member and holder = p_holder;
  -- The slot goes on to the next in line at once, not at the next caller's sweep.
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;
