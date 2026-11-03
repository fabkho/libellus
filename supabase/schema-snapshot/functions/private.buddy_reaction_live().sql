CREATE OR REPLACE FUNCTION private.buddy_reaction_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_row    public.buddy_reactions;
  v_read   uuid;
  v_author uuid;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  select buddy_read_id, author_id into v_read, v_author from public.buddy_messages where id = v_row.message_id;
  if v_read is null
     or (tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = v_row.member_id)) then
    return null;
  end if;
  perform private.buddy_send(
    'message.reaction',
    jsonb_build_object('message_id', v_row.message_id, 'buddy_read_id', v_read, 'member_id', v_row.member_id,
                       'emoji', case when tg_op = 'DELETE' then null else v_row.emoji end),
    array(select r from private.buddy_recipients(v_read, v_row.member_id) r
           where not private.buddy_hidden(r, v_author)));
  return null;
end;
$function$
;
