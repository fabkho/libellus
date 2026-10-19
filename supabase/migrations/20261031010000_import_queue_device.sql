-- The import queue knows which DEVICE a place belongs to (follow-up to 20261030020000_import_queue.sql).
--
-- A holder is one run of the app on a device (a tab: its name lives in sessionStorage), so after the app
-- was closed and opened again on the same device the new run is another holder, and the old run's place
-- (slot or line) was waited out for 75 s, shown as "running on another device". That was wrong: it IS the
-- same device. Each device now has a stable id (localStorage, made once) stored with the place: when the
-- same member asks from the same device again, the place is taken over at once (the new holder, the heartbeat
-- refreshed, the turn and the slot kept) and the import resumes. Another device of hers still gets her row
-- back with mine = false and the old 75 s expiry, as before.
--
-- Two tabs of one device share the id, so the later tab takes the place from the earlier one; an import is
-- not something she runs in two tabs at once.
--
-- `p_device` is optional (null = no device known: only the same holder reclaims, as before). Refusal:
-- device_invalid (22023). The two-argument import_slot_take is replaced by this one.

alter table public.import_queue
  add column device text check (device is null or char_length(device) between 1 and 64);

comment on column public.import_queue.device is
  'The device the place was taken from (a stable id the app keeps in localStorage); the same member from the same device takes it over at once.';

drop function public.import_slot_take(text, integer);

create function public.import_slot_take(p_holder text, p_rows integer default 0, p_device text default null)
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
  if p_holder is null or char_length(p_holder) not between 1 and 64 then
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
    where q.holder = excluded.holder or (excluded.device is not null and q.device = excluded.device);
  perform private.import_slot_sweep();
  return query select * from private.import_slot_state(v_member, p_holder);
end
$$;

revoke all on function public.import_slot_take(text, integer, text) from public, anon;
grant execute on function public.import_slot_take(text, integer, text) to authenticated;
