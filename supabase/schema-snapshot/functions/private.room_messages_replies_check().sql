CREATE OR REPLACE FUNCTION private.room_messages_replies_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (select 1 from public.room_messages c
               join public.room_messages p on p.id = c.reply_to
              where p.id = new.id
                and private.note_level(c.visibility) > private.note_level(p.visibility)) then
    raise exception 'note_wider_than_parent' using errcode = '23514';
  end if;
  return null;
end;
$function$
;
