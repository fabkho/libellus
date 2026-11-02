CREATE OR REPLACE FUNCTION private.buddy_message_for(p_message uuid, p_caller uuid)
 RETURNS buddy_messages
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read uuid;
  v_row  public.buddy_messages;
begin
  select buddy_read_id into v_read from public.buddy_messages where id = p_message;
  if v_read is null then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.buddy_gate(v_read, p_caller);
  perform private.buddy_lock_read(v_read);
  perform private.buddy_gate(v_read, p_caller);
  select * into v_row from public.buddy_messages where id = p_message for update;
  if not found or private.buddy_hidden(p_caller, v_row.author_id) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  return v_row;
end;
$function$
;
