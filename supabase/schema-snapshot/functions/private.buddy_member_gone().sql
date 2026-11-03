CREATE OR REPLACE FUNCTION private.buddy_member_gone()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_read public.buddy_reads;
  v_next public.buddy_read_members;
begin
  perform private.buddy_lock_read(old.buddy_read_id);
  select * into v_read from public.buddy_reads where id = old.buddy_read_id;
  if not found then
    return null;  -- the read itself is going
  end if;

  select * into v_next from public.buddy_read_members
   where buddy_read_id = old.buddy_read_id and joined_at is not null
   order by (role = 'host') desc, joined_at, member_id
   limit 1;
  if not found then
    delete from public.buddy_reads where id = old.buddy_read_id;
    return null;
  end if;

  if v_next.role <> 'host' then
    update public.buddy_read_members set role = 'host'
     where buddy_read_id = old.buddy_read_id and member_id = v_next.member_id;
    -- host_id follows her, unless that breaks one active read per host and Book (or, for a read
    -- of hers made at the same moment, its unique index): then it stays null. Never an error here,
    -- or a leave or an account deletion would fail.
    begin
      update public.buddy_reads
         set host_id = case
               when status = 'active' and exists (
                      select 1 from public.buddy_reads o
                        join public.buddy_read_members h
                          on h.buddy_read_id = o.id and h.member_id = v_next.member_id and h.role = 'host'
                       where o.book_id = v_read.book_id and o.status = 'active' and o.id <> v_read.id)
               then null
               else v_next.member_id
             end
       where id = old.buddy_read_id;
    exception when unique_violation then
      update public.buddy_reads set host_id = null where id = old.buddy_read_id;
    end;
  end if;
  return null;
end;
$function$
;
