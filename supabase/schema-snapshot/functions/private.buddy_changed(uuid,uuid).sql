CREATE OR REPLACE FUNCTION private.buddy_changed(p_read uuid, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_stmt text := statement_timestamp()::text;
  v_sent text := current_setting('buddy.changed_sent', true);
  v_to   uuid[];
begin
  if p_read is null or not exists (select 1 from public.buddy_reads where id = p_read) then
    return;
  end if;
  if v_sent is null or split_part(v_sent, ';', 1) <> v_stmt then
    v_sent := v_stmt;
  end if;
  select coalesce(array_agg(r), '{}') into v_to
    from private.buddy_recipients(p_read, p_actor) r
   where position(';' || p_read || ':' || r in v_sent) = 0;
  if cardinality(v_to) = 0 then
    return;
  end if;
  select v_sent || string_agg(';' || p_read || ':' || r, '') into v_sent from unnest(v_to) r;
  perform set_config('buddy.changed_sent', v_sent, true);
  perform private.buddy_send('buddy_read.changed', jsonb_build_object('buddy_read_id', p_read), v_to);
end;
$function$
;
