CREATE OR REPLACE FUNCTION public.react_to_buddy_message(p_message uuid, p_emoji text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_msg    public.buddy_messages;
  v_old    text;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('❤️', '😂', '😮', '😢', '🔥', '📚') then
    raise exception 'message_emoji_invalid' using errcode = '22023';
  end if;
  v_msg := private.buddy_message_for(p_message, v_caller);
  if (select status from public.buddy_reads where id = v_msg.buddy_read_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'message_unavailable' using errcode = 'PT409';
  end if;
  perform private.buddy_rate_window(v_caller, 'react', 60, interval '1 minute');

  select emoji into v_old from public.buddy_reactions where message_id = p_message and member_id = v_caller;
  if p_emoji is null or p_emoji = v_old then
    delete from public.buddy_reactions where message_id = p_message and member_id = v_caller;
  elsif v_old is null then
    insert into public.buddy_reactions (message_id, member_id, emoji) values (p_message, v_caller, p_emoji);
  else
    update public.buddy_reactions set emoji = p_emoji, created_at = clock_timestamp()
     where message_id = p_message and member_id = v_caller;
  end if;
end;
$function$
;
