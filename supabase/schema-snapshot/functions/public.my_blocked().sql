CREATE OR REPLACE FUNCTION public.my_blocked()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.blocked_id,
                                        'name', private.member_name(b.blocked_id),
                                        'photo', null)
                     order by b.created_at desc, b.blocked_id)
      from public.blocks b
     where b.blocker_id = v_caller
  ), '[]'::jsonb);
end;
$function$
;
