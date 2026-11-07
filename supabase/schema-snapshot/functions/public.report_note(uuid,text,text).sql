CREATE OR REPLACE FUNCTION public.report_note(p_note uuid, p_reason text, p_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller  uuid := auth.uid();
  v_text    text := nullif(btrim(coalesce(p_text, ''), E' \t\n\r'), '');
  v_row     public.room_messages;
  v_chapter smallint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('harassment', 'spam', 'inappropriate', 'other') then
    raise exception 'invalid_reason' using errcode = '22023';
  end if;
  if char_length(v_text) > 1000 then
    raise exception 'report_text_too_long' using errcode = '22023';
  end if;
  select * into v_row from public.room_messages m where m.id = p_note;
  if not found or v_row.deleted_at is not null or not private.can_see_note(v_caller, p_note) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  if v_row.author_id = v_caller then
    raise exception 'report_self' using errcode = '22023';
  end if;

  -- Reported before: her first report stands. Under her lock, so two at once make one row.
  perform private.notes_lock('notes', v_caller::text);
  if exists (select 1 from public.feedback f
              where f.member_id = v_caller and f.kind = 'report' and f.context ->> 'note' = p_note::text) then
    return jsonb_build_object('reported', true);
  end if;

  select s.position into v_chapter from public.room_sections s where s.id = v_row.section_id;
  insert into public.feedback (member_id, kind, body, context)
  values (v_caller, 'report',
          'Notes report: ' || p_reason || coalesce(E'\n\n' || v_text, ''),
          jsonb_build_object(
            'room', v_row.room_id,
            'chapter', v_chapter,
            'section', v_row.section_id,
            'note', v_row.id,
            'author', v_row.author_id,
            'visibility', v_row.visibility,
            'excerpt', left(v_row.body, 300)));
  return jsonb_build_object('reported', true);
end;
$function$
;
