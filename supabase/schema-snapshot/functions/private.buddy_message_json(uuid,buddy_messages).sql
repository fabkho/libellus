CREATE OR REPLACE FUNCTION private.buddy_message_json(p_caller uuid, p_message buddy_messages)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select jsonb_build_object(
    'id', p_message.id,
    'section_id', p_message.section_id,
    'author', jsonb_build_object('id', p_message.author_id, 'name', private.member_name(p_message.author_id)),
    'client_id', p_message.client_id,
    'kind', case when p_message.deleted_at is null then p_message.kind else 'text' end,
    'body', case when p_message.deleted_at is null then p_message.body end,
    'media_url', case when p_message.deleted_at is null then p_message.media_url end,
    'media_width', case when p_message.deleted_at is null then p_message.media_width end,
    'media_height', case when p_message.deleted_at is null then p_message.media_height end,
    'reply_to', (select r.id from public.buddy_messages r
                  where r.id = p_message.reply_to and not private.buddy_hidden(p_caller, r.author_id)),
    'spoiler', p_message.spoiler,
    'created_at', p_message.created_at,
    'deleted_at', p_message.deleted_at,
    'reactions', case when p_message.deleted_at is null
                      then private.buddy_reactions_json(p_caller, p_message.id) else '[]'::jsonb end
  ) || case when p_message.deleted_at is null and p_message.voice_mime is not null
            then jsonb_build_object('voice', jsonb_build_object(
                   'path', private.buddy_voice_path(p_message.buddy_read_id, p_message.author_id, p_message.client_id, p_message.voice_mime),
                   'mime', p_message.voice_mime,
                   'duration_ms', p_message.voice_duration_ms,
                   'peaks', to_jsonb(p_message.voice_peaks)))
            else '{}'::jsonb end
$function$
;
