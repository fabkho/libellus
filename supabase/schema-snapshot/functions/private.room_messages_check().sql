CREATE OR REPLACE FUNCTION private.room_messages_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_kind   text;
  v_parent public.room_messages;
begin
  select r.kind into v_kind from public.rooms r where r.id = new.room_id;

  if v_kind = 'notes' then
    if new.visibility = 'members' then
      raise exception 'room_message_invalid: a note is private, friends or public' using errcode = '23514';
    end if;
    if new.section_id is null then
      raise exception 'room_message_invalid: a note is in a chapter' using errcode = '23514';
    end if;
  elsif new.visibility <> 'members' then
    raise exception 'room_message_invalid: a buddy message is for its members' using errcode = '23514';
  end if;

  if new.section_id is not null
     and not exists (select 1 from public.room_sections s where s.id = new.section_id and s.room_id = new.room_id) then
    raise exception 'room_message_invalid: the Section is of another room' using errcode = '23514';
  end if;

  if new.reply_to is not null
     and (tg_op = 'INSERT' or new.reply_to is distinct from old.reply_to
          or new.visibility is distinct from old.visibility
          or new.room_id is distinct from old.room_id or new.section_id is distinct from old.section_id) then
    select * into v_parent from public.room_messages p where p.id = new.reply_to;
    if v_parent.room_id is distinct from new.room_id or v_parent.section_id is distinct from new.section_id then
      raise exception 'room_message_invalid: a reply stays in its thread' using errcode = '23514';
    end if;
    if (new.visibility = 'members') <> (v_parent.visibility = 'members')
       or private.note_level(new.visibility) > private.note_level(v_parent.visibility) then
      raise exception 'note_wider_than_parent' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$
;
