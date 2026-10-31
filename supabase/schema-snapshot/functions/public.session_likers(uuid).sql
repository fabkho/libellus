CREATE OR REPLACE FUNCTION public.session_likers(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;
