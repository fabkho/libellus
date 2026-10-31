CREATE OR REPLACE FUNCTION public.member_want(p_member uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_out    jsonb;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.visible(v_caller, p_member) or not (private.social_of(p_member)).show_want then
    return null;
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('book', private.social_book_json(b), 'addedOn', w.added_at::date)
           order by w.added_at desc, w.id desc), '[]'::jsonb)
    into v_out
    from public.library_entries w
    join public.books b on b.id = w.book_id
   where w.member_id = p_member and not w.hidden and w.status = 'want_to_read';

  return v_out;
end;
$function$
;
