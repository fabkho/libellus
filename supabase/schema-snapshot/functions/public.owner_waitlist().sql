CREATE OR REPLACE FUNCTION public.owner_waitlist()
 RETURNS TABLE(id uuid, email text, created_at timestamp with time zone, invited_at timestamp with time zone, source text, member_name text, note text)
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
    select w.id, w.email::text, w.created_at, w.invited_at, w.source,
           case when w.source_member_id is null then null else private.reading_page_name(w.source_member_id) end,
           w.note
      from private.waitlist w
     order by w.created_at desc, w.id
     limit 5000;
end;
$function$
;
