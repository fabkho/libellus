CREATE OR REPLACE FUNCTION public.feedback_list(p_limit integer DEFAULT 30, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(id uuid, kind text, body text, context jsonb, created_at timestamp with time zone, handled_at timestamp with time zone, member_name text, member_email text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  if not private.is_instance_owner() then
    raise exception 'not_owner' using errcode = '42501';
  end if;

  return query
    select f.id, f.kind, f.body, f.context, f.created_at, f.handled_at,
           private.reading_page_name(f.member_id),
           (select u.email::text from auth.users u where u.id = f.member_id)
      from public.feedback f
     where p_before is null or f.created_at < p_before
     order by f.created_at desc, f.id
     limit least(greatest(coalesce(p_limit, 30), 1), 100);
end;
$function$
;
