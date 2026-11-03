CREATE OR REPLACE FUNCTION private.buddy_member_live()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_row public.buddy_read_members;
begin
  if tg_op = 'DELETE' then v_row := old; else v_row := new; end if;
  if tg_op <> 'UPDATE' and v_row.joined_at is null then
    -- An invitation made, or one declined or withdrawn. Not when her account or the read is going.
    if exists (select 1 from public.buddy_reads where id = v_row.buddy_read_id)
       and exists (select 1 from auth.users u where u.id = v_row.member_id) then
      perform private.buddy_send('buddy.invitation',
                                 jsonb_build_object('buddy_read_id', v_row.buddy_read_id),
                                 array[v_row.member_id]);
    end if;
    return null;
  end if;
  perform private.buddy_changed(v_row.buddy_read_id, v_row.member_id);
  return null;
end;
$function$
;
