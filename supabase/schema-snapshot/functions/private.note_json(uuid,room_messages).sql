CREATE OR REPLACE FUNCTION private.note_json(p_viewer uuid, p_note room_messages)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_note.id,
    'sectionId', p_note.section_id,
    'clientId', case when p_note.author_id = p_viewer then p_note.client_id end,
    'author', private.member_card(p_viewer, p_note.author_id),
    'mine', p_note.author_id = p_viewer,
    'body', case when p_note.deleted_at is null then p_note.body end,
    'kind', case when p_note.deleted_at is null then 'note'
                 when p_note.moderated then 'moderated'
                 else 'removed' end,
    'visibility', p_note.visibility,
    'effectiveVisibility', case when p_note.visibility = 'public' and not private.notes_public_enabled()
                                then 'friends' else p_note.visibility end,
    'spoiler', p_note.spoiler,
    'createdAt', p_note.created_at,
    'quote', case when p_note.reply_to is not null then private.note_quote(p_viewer, p_note.reply_to) end,
    'reactions', case when p_note.deleted_at is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n)
                         order by array_position(array['❤️', '😂', '😮', '😢', '🔥', '📚'], x.emoji))
          from (select r.emoji, count(*)::integer as n
                  from public.room_reactions r
                 where r.message_id = p_note.id
                   and (r.member_id = p_viewer or not private.blocked_either(p_viewer, r.member_id))
                 group by r.emoji) x), '[]'::jsonb) end,
    'myReaction', case when p_note.deleted_at is null then
        (select r.emoji from public.room_reactions r where r.message_id = p_note.id and r.member_id = p_viewer) end
  ) || case when p_note.deleted_at is null and p_note.voice_object is not null and p_note.author_id = p_viewer
            then jsonb_build_object('voice', jsonb_build_object(
                   'path', p_note.voice_object,
                   'mime', p_note.voice_mime,
                   'durationMs', p_note.voice_duration_ms,
                   'peaks', to_jsonb(p_note.voice_peaks)))
            else '{}'::jsonb end
$function$
;
