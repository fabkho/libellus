CREATE OR REPLACE FUNCTION public.buddy_read_link(p_id uuid, p_on boolean, p_renew boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_read   public.buddy_reads;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_host_gate(p_id, v_caller);
  perform private.buddy_lock_read(p_id);
  v_read := private.buddy_host_gate(p_id, v_caller);

  if not coalesce(p_on, false) then
    update public.buddy_reads set link_token = null where id = p_id;
    return null;
  end if;
  if v_read.status <> 'active' then
    raise exception 'buddy_read_ended' using errcode = 'PT409';
  end if;
  if v_read.link_token is null or coalesce(p_renew, false) then
    update public.buddy_reads set link_token = private.reading_page_token() where id = p_id
    returning link_token into v_read.link_token;
  end if;
  return v_read.link_token;
end;
$function$
;
