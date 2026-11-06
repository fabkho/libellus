CREATE OR REPLACE FUNCTION public.delete_note(p_note uuid)
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
  select m.* into v_row from public.room_messages m join public.rooms r on r.id = m.room_id
   where m.id = p_note and r.kind = 'notes' and m.author_id = v_caller
   for update of m;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.deleted_at is null then
    delete from public.room_reactions where message_id = p_note;
    update public.room_messages set body = '', deleted_at = clock_timestamp(), deleted_by = v_caller
     where id = p_note
    returning * into v_row;
  end if;
  return private.note_json(v_caller, v_row);
end;
$function$
;
