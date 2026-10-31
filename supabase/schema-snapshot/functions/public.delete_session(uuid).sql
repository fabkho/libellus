CREATE OR REPLACE FUNCTION public.delete_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member   uuid := auth.uid();
  v_entry_id uuid;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select s.entry_id into v_entry_id
    from public.reading_sessions s
    join public.library_entries e on e.id = s.entry_id
   where s.id = p_session_id and e.member_id = v_member;
  if v_entry_id is null then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
  -- Locked, so a read started on another device cannot slip in between the
  -- delete and the Status that follows it.
  perform 1 from public.library_entries where id = v_entry_id for update;

  delete from public.reading_sessions where id = p_session_id;
  if not found then
    raise exception 'session_not_found' using errcode = 'P0002';
  end if;
end;
$function$
;
