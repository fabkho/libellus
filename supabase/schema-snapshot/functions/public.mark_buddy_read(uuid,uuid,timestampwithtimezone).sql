CREATE OR REPLACE FUNCTION public.mark_buddy_read(p_read uuid, p_section uuid, p_through timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_to     timestamptz;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;
  -- Nothing to move: answer before the lock.
  if p_through is not null and p_through <= (
       case when p_section is null
            then (select last_read_at from public.buddy_read_members where buddy_read_id = p_read and member_id = v_caller)
            else (select last_read_at from public.buddy_section_cursors where section_id = p_section and member_id = v_caller)
       end) then
    return;
  end if;
  perform private.buddy_lock_read(p_read);
  perform private.buddy_gate(p_read, v_caller);
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;

  v_to := greatest(clock_timestamp(), (select max(created_at) from public.buddy_messages where buddy_read_id = p_read));
  v_to := least(coalesce(p_through, v_to), v_to);

  if p_section is null then
    update public.buddy_read_members set last_read_at = greatest(last_read_at, v_to)
     where buddy_read_id = p_read and member_id = v_caller
       and (last_read_at is null or last_read_at < v_to);
  else
    insert into public.buddy_section_cursors as c (section_id, member_id, last_read_at)
    values (p_section, v_caller, v_to)
    on conflict (section_id, member_id)
      do update set last_read_at = greatest(c.last_read_at, excluded.last_read_at);
  end if;
end;
$function$
;
