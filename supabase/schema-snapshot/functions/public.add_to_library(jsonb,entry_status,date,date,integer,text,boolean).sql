CREATE OR REPLACE FUNCTION public.add_to_library(p_book jsonb, p_status entry_status DEFAULT 'want_to_read'::entry_status, p_started_on date DEFAULT NULL::date, p_ended_on date DEFAULT NULL::date, p_rating integer DEFAULT NULL::integer, p_review text DEFAULT NULL::text, p_review_spoilers boolean DEFAULT false)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
declare
  v_member uuid := auth.uid();
  v_id     uuid;
  v_entry  public.library_entries;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  v_id := public.catalogue_book_for(p_book);

  begin
    insert into public.library_entries (member_id, book_id)
    values (v_member, v_id)
    returning * into v_entry;
  exception when unique_violation then
    raise exception 'already_in_library' using errcode = '23505';
  end;

  -- Raises on anything wrong with the dates, Rating or review, which undoes
  -- the entry (and a Book this call added) with it.
  perform public.add_first_session(v_entry.id, p_status, p_started_on, p_ended_on, p_rating, p_review, p_review_spoilers);

  -- The status the session gave it.
  select * into v_entry from public.library_entries where id = v_entry.id;
  return v_entry;
end;
$function$
;
