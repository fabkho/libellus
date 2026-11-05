CREATE OR REPLACE FUNCTION public.report_buddy_message(p_message uuid, p_reason text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_note   text := nullif(btrim(coalesce(p_note, ''), E' \t\n\r'), '');
  v_msg    public.buddy_messages;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'report_reason_invalid' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'report_note_too_long' using errcode = '22023';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller);
  if v_msg.author_id = v_caller then
    raise exception 'report_self' using errcode = '22023';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message_unavailable' using errcode = 'PT409';
  end if;
  -- Reported before: her first report stands. Under the read's lock, so two at once make one row.
  if exists (select 1 from public.feedback f
              where f.member_id = v_caller and f.kind = 'report' and f.context ->> 'message' = v_msg.id::text) then
    return;
  end if;

  insert into public.feedback (member_id, kind, body, context)
  values (v_caller, 'report',
          'Buddy read report: ' || p_reason || coalesce(E'\n\n' || v_note, ''),
          jsonb_build_object(
            'buddy_read', v_msg.buddy_read_id,
            'section', v_msg.section_id,
            'message', v_msg.id,
            'author', v_msg.author_id,
            'kind', v_msg.kind,
            'excerpt', case when v_msg.kind = 'voice'
                            then 'Voice message, ' || round(v_msg.voice_duration_ms / 1000.0)::integer || ' s'
                            else left(concat_ws(' ', nullif(v_msg.body, ''), v_msg.media_url), 300) end));
end;
$function$
;
