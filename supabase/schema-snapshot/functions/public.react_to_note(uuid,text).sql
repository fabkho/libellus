CREATE OR REPLACE FUNCTION public.react_to_note(p_note uuid, p_emoji text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.room_messages;
  v_old    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('❤️', '😂', '😮', '😢', '🔥', '📚') then
    raise exception 'invalid_emoji' using errcode = '22023';
  end if;
  select * into v_row from public.room_messages m where m.id = p_note;
  if not found or v_row.deleted_at is not null or not private.can_see_note(v_caller, p_note) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.note_rate(v_caller, 'react', 60, interval '1 minute');

  select r.emoji into v_old from public.room_reactions r where r.message_id = p_note and r.member_id = v_caller;
  if p_emoji is null or p_emoji = v_old then
    delete from public.room_reactions where message_id = p_note and member_id = v_caller;
  elsif v_old is null then
    insert into public.room_reactions (message_id, member_id, emoji) values (p_note, v_caller, p_emoji)
    on conflict (message_id, member_id) do update set emoji = excluded.emoji, created_at = clock_timestamp();
  else
    update public.room_reactions set emoji = p_emoji, created_at = clock_timestamp()
     where message_id = p_note and member_id = v_caller;
  end if;
  return private.note_json(v_caller, v_row);
end;
$function$
;
