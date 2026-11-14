CREATE OR REPLACE FUNCTION public.edit_note(p_note uuid, p_body text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_body is null or p_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
    raise exception 'body_empty' using errcode = '22023';
  end if;
  if char_length(p_body) > 2000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;

  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller
   for update of m;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.deleted_at is not null or v_row.kind <> 'text' then
    raise exception 'note_not_editable' using errcode = '22023';
  end if;

  update public.room_messages
     set body = p_body, edited_at = clock_timestamp()
   where id = p_note
  returning * into v_row;
  return private.note_json(v_caller, v_row);
end;
$function$
;
