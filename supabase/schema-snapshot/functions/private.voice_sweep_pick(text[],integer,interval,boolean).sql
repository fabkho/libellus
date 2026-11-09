CREATE OR REPLACE FUNCTION private.voice_sweep_pick(p_buckets text[], p_limit integer, p_grace interval, p_orphans boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_out   jsonb;
begin
  if coalesce(p_orphans, false) then
    if 'buddy-voice' = any (p_buckets) then
      insert into private.buddy_voice_trash (bucket, path)
      select 'buddy-voice', o.name
        from storage.objects o
       where o.bucket_id = 'buddy-voice'
         and o.created_at < now() - p_grace
         and not exists (select 1 from private.buddy_voice_trash t where t.bucket = 'buddy-voice' and t.path = o.name)
         and not private.buddy_voice_attached(o.name)
       limit v_limit
      on conflict do nothing;
    end if;
    if 'note-voice' = any (p_buckets) then
      insert into private.buddy_voice_trash (bucket, path)
      select 'note-voice', o.name
        from storage.objects o
       where o.bucket_id = 'note-voice'
         and o.created_at < now() - p_grace
         and not exists (select 1 from private.buddy_voice_trash t where t.bucket = 'note-voice' and t.path = o.name)
         and not private.note_voice_attached(o.name)
       limit v_limit
      on conflict do nothing;
    end if;
  end if;

  delete from private.buddy_voice_trash t
   where t.bucket = any (p_buckets)
     and ((t.bucket = 'buddy-voice' and private.buddy_voice_attached(t.path))
          or (t.bucket = 'note-voice' and private.note_voice_attached(t.path))
          or not exists (select 1 from storage.objects o where o.bucket_id = t.bucket and o.name = t.path));

  with picked as (
    select t.bucket, t.path
      from private.buddy_voice_trash t
     where t.bucket = any (p_buckets)
       and t.attempts < 20
       and (t.last_attempt_at is null or t.last_attempt_at < now() - t.attempts * interval '5 minutes')
     order by t.attempts, t.queued_at
     limit v_limit
       for update skip locked
  ), marked as (
    update private.buddy_voice_trash t
       set attempts = t.attempts + 1, last_attempt_at = now()
      from picked
     where t.bucket = picked.bucket and t.path = picked.path
    returning t.bucket, t.path, t.queued_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', m.bucket, 'path', m.path) order by m.queued_at, m.path), '[]'::jsonb)
    into v_out from marked m;
  return v_out;
end;
$function$
;
