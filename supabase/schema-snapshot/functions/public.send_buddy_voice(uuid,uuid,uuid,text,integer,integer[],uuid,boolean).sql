CREATE OR REPLACE FUNCTION public.send_buddy_voice(p_read uuid, p_section uuid, p_client_id uuid, p_mime text, p_duration_ms integer, p_peaks integer[] DEFAULT NULL::integer[], p_reply_to uuid DEFAULT NULL::uuid, p_spoiler boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.buddy_messages;
  v_status text;
  v_path   text;
  v_object jsonb;
  v_size   bigint;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'message_client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- A retry: the message it made, before the gate (a retry after she left still gets its answer).
  select * into v_row from public.buddy_messages where author_id = v_caller and client_id = p_client_id;
  if found then
    if v_row.buddy_read_id is distinct from p_read or v_row.section_id is distinct from p_section
       or v_row.kind is distinct from 'voice' then
      raise exception 'message_client_id_reused' using errcode = 'PT409';
    end if;
    return private.buddy_message_json(v_caller, v_row);
  end if;

  perform private.buddy_gate(p_read, v_caller);
  perform private.buddy_lock_read(p_read);
  perform private.buddy_gate(p_read, v_caller);

  select status into v_status from public.buddy_reads where id = p_read;
  if v_status = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;
  if p_section is not null
     and not exists (select 1 from public.buddy_read_sections where id = p_section and buddy_read_id = p_read) then
    raise exception 'buddy_section_invalid' using errcode = '22023';
  end if;
  if coalesce(p_spoiler, false) and p_section is null then
    raise exception 'message_spoiler_unavailable' using errcode = '22023';
  end if;

  if private.buddy_voice_ext(p_mime) is null
     or p_duration_ms is null or p_duration_ms not between 1 and 120000
     or (p_peaks is not null and (cardinality(p_peaks) not between 1 and 48
                                  or 0 > any (p_peaks) or 100 < any (p_peaks))) then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;

  -- The object: there, of the type said, not empty, not over the bucket's 3 MB.
  v_path := private.buddy_voice_path(p_read, v_caller, p_client_id, p_mime);
  select o.metadata into v_object from storage.objects o where o.bucket_id = 'buddy-voice' and o.name = v_path;
  if not found then
    raise exception 'message_voice_missing' using errcode = '22023';
  end if;
  if v_object ->> 'mimetype' is distinct from p_mime then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;
  v_size := coalesce(nullif(v_object ->> 'size', '')::bigint, 0);
  if v_size > 3 * 1024 * 1024 then
    raise exception 'message_voice_too_large' using errcode = '22023';
  end if;
  if v_size < 1 then
    raise exception 'message_voice_invalid' using errcode = '22023';
  end if;

  if p_reply_to is not null and not exists (
    select 1 from public.buddy_messages r
     where r.id = p_reply_to and r.buddy_read_id = p_read and r.section_id is not distinct from p_section
       and r.deleted_at is null and not private.buddy_hidden(v_caller, r.author_id)
  ) then
    raise exception 'message_reply_unavailable' using errcode = '22023';
  end if;

  -- The limits of every message: 30 a minute, 600 a day, over all her reads, under her member lock.
  if (select count(*) from public.buddy_messages
       where author_id = v_caller and created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.buddy_messages
          where author_id = v_caller and created_at > clock_timestamp() - interval '1 day') >= 600 then
    raise exception 'message_rate_limited' using errcode = 'PT429';
  end if;
  -- And a voice message's own, which keeps the bucket small: 10 a minute, 100 a day.
  perform private.buddy_rate_window(v_caller, 'voice', 10, interval '1 minute');
  perform private.buddy_rate_window(v_caller, 'voice_day', 100, interval '1 day');

  insert into public.buddy_messages (buddy_read_id, section_id, author_id, client_id, kind, body,
                                     voice_mime, voice_duration_ms, voice_peaks, reply_to, spoiler, created_at)
  values (p_read, p_section, v_caller, p_client_id, 'voice', '',
          p_mime, p_duration_ms, p_peaks::smallint[], p_reply_to, coalesce(p_spoiler, false),
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.buddy_messages m where m.buddy_read_id = p_read)))
  returning * into v_row;
  return private.buddy_message_json(v_caller, v_row);
end;
$function$
;
