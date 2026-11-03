CREATE OR REPLACE FUNCTION private.buddy_message_new()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  perform private.buddy_send(
    'message.new',
    jsonb_build_object(
      'id', new.id, 'buddy_read_id', new.buddy_read_id, 'section_id', new.section_id,
      'author_id', new.author_id, 'client_id', new.client_id, 'kind', new.kind, 'body', new.body,
      'media_url', new.media_url, 'media_width', new.media_width, 'media_height', new.media_height,
      'reply_to', new.reply_to, 'spoiler', new.spoiler, 'created_at', new.created_at),
    array(select private.buddy_recipients(new.buddy_read_id, new.author_id)));
  return null;
end;
$function$
;
