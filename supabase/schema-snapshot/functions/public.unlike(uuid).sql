CREATE OR REPLACE FUNCTION public.unlike(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
