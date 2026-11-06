CREATE OR REPLACE FUNCTION public.set_book_chapters(p_book uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_owner  uuid;
  v_key    text;
  v_room   uuid;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select b.owner_id into v_owner from public.books b where b.id = p_book;
  if not found or (v_owner is not null and v_owner <> v_caller) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  v_key := private.book_work_key(p_book);
  if v_key is null then
    raise exception 'notes_unavailable' using errcode = '22023';
  end if;
  if p_count is null or p_count not between 1 and 300 then
    raise exception 'invalid_count' using errcode = '22023';
  end if;
  if not private.has_work(v_caller, v_key) then
    raise exception 'notes_need_book' using errcode = 'PT403';
  end if;

  -- Two at once: the second waits here and then finds the first's room.
  perform private.notes_lock('notes_work', v_key);
  if (private.notes_room_for(p_book)).id is not null then
    raise exception 'chapters_already_set' using errcode = 'PT409';
  end if;
  perform private.note_rate(v_caller, 'chapters', 20, interval '1 day');

  insert into public.rooms (kind, work_key, book_id, chapters_set_by)
  values ('notes', v_key, p_book, v_caller)
  returning id into v_room;
  insert into public.room_sections (room_id, position, kind)
  select v_room, k::smallint, 'part' from generate_series(1, p_count) k
  union all
  select v_room, (p_count + 1)::smallint, 'end';

  return private.notes_page(v_caller, v_key, v_room);
end;
$function$
;
