CREATE OR REPLACE FUNCTION private.buddy_message_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_send(
    'message.deleted',
    jsonb_build_object('id', new.id, 'buddy_read_id', new.buddy_read_id, 'section_id', new.section_id),
    array(select private.buddy_recipients(new.buddy_read_id, new.author_id)));
  return null;
end;
$function$
;
