CREATE OR REPLACE FUNCTION private.notes_page(p_viewer uuid, p_work_key text, p_room uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_me       jsonb;
  v_chapter  integer;
  v_finished boolean;
  v_parts    integer;
  v_chapters jsonb;
begin
  if p_room is null then
    return jsonb_build_object('workKey', p_work_key, 'canWrite', private.has_work(p_viewer, p_work_key), 'room', null);
  end if;

  v_me := private.note_chapter(p_viewer, p_room);
  v_chapter := (v_me ->> 'chapter')::integer;
  v_finished := (v_me ->> 'finished')::boolean;
  select count(*)::integer into v_parts from public.room_sections s where s.room_id = p_room and s.kind = 'part';

  with v as materialized (
    select n.section_id, n.author_id, n.created_at
      from private.visible_notes(p_viewer, p_room) n
     where n.deleted_at is null
  ),
  counts as (
    select v.section_id,
           count(*)::integer as n,
           count(*) filter (where v.author_id <> p_viewer
                              and (c.last_read_at is null or v.created_at > c.last_read_at))::integer as unread
      from v
      left join public.room_cursors c on c.section_id = v.section_id and c.member_id = p_viewer
     group by v.section_id
  ),
  authors as (
    select a.section_id, array_agg(a.author_id order by a.last desc, a.author_id) as ids
      from (select v.section_id, v.author_id, max(v.created_at) as last,
                   row_number() over (partition by v.section_id order by max(v.created_at) desc, v.author_id) as k
              from v group by v.section_id, v.author_id) a
     where a.k <= 3
     group by a.section_id
  ),
  secs as (
    select s.id, s.position, s.kind,
           case when s.kind = 'part' then v_finished or s.position <= v_chapter else v_finished end as open
      from public.room_sections s
     where s.room_id = p_room
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', secs.id,
           'position', secs.position,
           'kind', secs.kind,
           'count', coalesce(counts.n, 0),
           'unread', case when secs.open then coalesce(counts.unread, 0) else 0 end,
           'open', secs.open,
           'faces', case when secs.open and authors.ids is not null
                         then (select jsonb_agg(private.member_card(p_viewer, x.id) order by x.o)
                                 from unnest(authors.ids) with ordinality x(id, o))
                         else '[]'::jsonb end)
         order by secs.position), '[]'::jsonb)
    into v_chapters
    from secs
    left join counts on counts.section_id = secs.id
    left join authors on authors.section_id = secs.id;

  return jsonb_build_object(
    'workKey', p_work_key,
    'canWrite', private.has_work(p_viewer, p_work_key),
    'room', jsonb_build_object('id', p_room, 'chapterCount', v_parts, 'me', v_me, 'chapters', v_chapters));
end;
$function$
;
