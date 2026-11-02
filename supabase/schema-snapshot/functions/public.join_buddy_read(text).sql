CREATE OR REPLACE FUNCTION public.join_buddy_read(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
  v_mine   public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.buddy_lock_member(v_caller);
  select * into v_read from public.buddy_reads where link_token = p_token;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  perform private.buddy_lock_read(v_read.id);

  -- Everything again under the read's lock: the token, the status, her row, a block.
  select * into v_read from public.buddy_reads where id = v_read.id and link_token = p_token;
  if not found or v_read.status <> 'active' then
    raise exception 'not_found' using errcode = 'PT404';
  end if;
  select * into v_mine from public.buddy_read_members where buddy_read_id = v_read.id and member_id = v_caller;
  if v_mine.joined_at is not null then
    return jsonb_build_object('id', v_read.id);
  end if;
  if exists (select 1 from public.buddy_read_members x
              where x.buddy_read_id = v_read.id and x.member_id <> v_caller
                and private.blocked_either(x.member_id, v_caller)) then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  perform private.buddy_rate(v_caller, 'join', 30);
  if private.buddy_active_count(v_caller) >= 10 then
    raise exception 'buddy_read_limit' using errcode = 'PT429';
  end if;

  if v_mine.member_id is not null then
    update public.buddy_read_members set joined_at = clock_timestamp()
     where buddy_read_id = v_read.id and member_id = v_caller;
  else
    if (select count(*) from public.buddy_read_members where buddy_read_id = v_read.id) >= 12 then
      raise exception 'buddy_read_full' using errcode = 'PT409';
    end if;
    insert into public.buddy_read_members (buddy_read_id, member_id, role, joined_at)
    values (v_read.id, v_caller, 'member', clock_timestamp());
  end if;
  return jsonb_build_object('id', v_read.id);
end;
$function$
;
