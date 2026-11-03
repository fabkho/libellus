CREATE OR REPLACE FUNCTION public.post_buddy_message(p_read uuid, p_section uuid, p_client_id uuid, p_kind text, p_body text, p_reply_to uuid DEFAULT NULL::uuid, p_spoiler boolean DEFAULT false, p_gif jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_row    public.buddy_messages;
  v_status text;
  v_body   text := coalesce(p_body, '');
  v_url    text;
  v_width  integer;
  v_height integer;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_client_id is null then
    raise exception 'message_client_id_required' using errcode = '22023';
  end if;

  perform private.buddy_lock_member(v_caller);

  -- A retry: the message it made. Before the gate, so a retry after she left still gets its answer.
  select * into v_row from public.buddy_messages where author_id = v_caller and client_id = p_client_id;
  if found then
    if v_row.buddy_read_id is distinct from p_read or v_row.section_id is distinct from p_section
       or v_row.kind is distinct from p_kind then
      raise exception 'message_client_id_reused' using errcode = 'PT409';
    end if;
    return private.buddy_message_json(v_caller, v_row);
  end if;

  -- The gate, then the read's lock, then the gate again: a removal or a leave that held the lock while
  -- she passed the first check has happened by now, and she is refused instead of written after it.
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

  if p_kind = 'text' then
    if p_gif is not null then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
    if char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:][:cntrl:]\u00a0\u200b]' then
      raise exception 'message_body_invalid' using errcode = '22023';
    end if;
  elsif p_kind = 'gif' then
    if char_length(v_body) > 2000 then
      raise exception 'message_body_invalid' using errcode = '22023';
    end if;
    if jsonb_typeof(p_gif) is distinct from 'object'
       or jsonb_typeof(p_gif -> 'url') is distinct from 'string'
       or jsonb_typeof(p_gif -> 'width') is distinct from 'number'
       or jsonb_typeof(p_gif -> 'height') is distinct from 'number'
       or (p_gif ->> 'width') !~ '^[0-9]{1,5}$' or (p_gif ->> 'height') !~ '^[0-9]{1,5}$' then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
    v_url := p_gif ->> 'url';
    v_width := (p_gif ->> 'width')::integer;
    v_height := (p_gif ->> 'height')::integer;
    if char_length(v_url) > 500
       or v_url !~ '^https://static[0-9]*\.klipy\.com/[A-Za-z0-9._~%/+=?&-]+$'
       or v_width not between 1 and 10000 or v_height not between 1 and 10000 then
      raise exception 'message_gif_invalid' using errcode = '22023';
    end if;
  else
    raise exception 'message_kind_invalid' using errcode = '22023';
  end if;

  -- An answer stays in its thread, to a live message she can see.
  if p_reply_to is not null and not exists (
    select 1 from public.buddy_messages r
     where r.id = p_reply_to and r.buddy_read_id = p_read and r.section_id is not distinct from p_section
       and r.deleted_at is null and not private.buddy_hidden(v_caller, r.author_id)
  ) then
    raise exception 'message_reply_unavailable' using errcode = '22023';
  end if;

  -- 30 a minute, 600 a day, over all her reads; under her member lock, so two at once cannot both pass.
  if (select count(*) from public.buddy_messages
       where author_id = v_caller and created_at > clock_timestamp() - interval '1 minute') >= 30
     or (select count(*) from public.buddy_messages
          where author_id = v_caller and created_at > clock_timestamp() - interval '1 day') >= 600 then
    raise exception 'message_rate_limited' using errcode = 'PT429';
  end if;

  insert into public.buddy_messages (buddy_read_id, section_id, author_id, client_id, kind, body,
                                     media_url, media_width, media_height, reply_to, spoiler, created_at)
  values (p_read, p_section, v_caller, p_client_id, p_kind, v_body,
          v_url, v_width, v_height, p_reply_to, coalesce(p_spoiler, false),
          greatest(clock_timestamp(),
                   (select max(m.created_at) + interval '1 microsecond'
                      from public.buddy_messages m where m.buddy_read_id = p_read)))
  returning * into v_row;
  return private.buddy_message_json(v_caller, v_row);
end;
$function$
;
