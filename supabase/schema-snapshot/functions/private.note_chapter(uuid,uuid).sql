CREATE OR REPLACE FUNCTION private.note_chapter(p_viewer uuid, p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_key      text;
  v_parts    integer;
  v_finished boolean;
  v_fraction numeric;
  v_auto     integer;
  v_hand     public.note_positions;
begin
  select r.work_key into v_key from public.rooms r where r.id = p_room;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  -- Over all her entries of the Work: a finished read at any time, and the furthest open session.
  select coalesce(bool_or(exists (select 1 from public.reading_sessions f
                                    where f.entry_id = e.id and f.outcome = 'finished')), false),
         max(case when o.id is not null then
               least(1::numeric, coalesce(o.progress_page::numeric / nullif(coalesce(e.page_count_override, b.page_count), 0),
                                          o.progress_percent::numeric / 100,
                                          0))
             end)
    into v_finished, v_fraction
    from public.library_entries e
    join public.books b on b.id = e.book_id
    left join public.reading_sessions o on o.entry_id = e.id and o.outcome is null
   where p_viewer is not null and e.member_id = p_viewer
     and e.book_id in (select private.work_books(v_key));

  v_auto := case when v_finished then v_parts
                 when v_fraction is not null then least(v_parts, greatest(1, floor(v_fraction * v_parts)::integer))
                 else 0 end;

  select * into v_hand from public.note_positions p where p.room_id = p_room and p.member_id = p_viewer;

  return jsonb_build_object(
    'chapter', case when v_hand.member_id is null then v_auto
                    when v_hand.hand_finished then v_parts
                    else least(v_hand.hand_chapter::integer, v_parts) end,
    'finished', case when v_hand.member_id is null then v_finished else v_hand.hand_finished end,
    'hand', v_hand.member_id is not null,
    'auto', jsonb_build_object('chapter', v_auto, 'finished', v_finished));
end;
$function$
;
