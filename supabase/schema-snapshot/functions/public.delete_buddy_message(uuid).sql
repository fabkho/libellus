CREATE OR REPLACE FUNCTION public.delete_buddy_message(p_message uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller, p_as_host => true);
  if v_msg.author_id <> v_caller and (private.buddy_gate(v_msg.buddy_read_id, v_caller)).role <> 'host' then
    raise exception 'message_not_yours' using errcode = 'PT403';
  end if;
  if v_msg.deleted_at is not null then
    return;
  end if;
  delete from public.buddy_reactions where message_id = p_message;
  update public.buddy_messages
     set body = '', media_url = null, media_width = null, media_height = null,
         deleted_at = clock_timestamp(), deleted_by = v_caller
   where id = p_message;
end;
$function$
;
