CREATE OR REPLACE FUNCTION public.save_reader_highlight(p_id uuid, p_entry_id uuid, p_file_hash text, p_cfi text, p_section_index integer, p_color text, p_excerpt text DEFAULT ''::text, p_note text DEFAULT NULL::text, p_deleted boolean DEFAULT false, p_at timestamp with time zone DEFAULT now(), p_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS reader_highlights
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member  uuid := auth.uid();
  v_at      timestamptz;
  v_created timestamptz;
  v_deleted boolean := coalesce(p_deleted, false);
  v_row     public.reader_highlights;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.library_entries e where e.id = p_entry_id and e.member_id = v_member
  ) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_id is null
     or p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$'
     or p_cfi is null or char_length(p_cfi) not between 1 and 2000
     or p_section_index is null or p_section_index < 0
     or p_color is null or p_color not in ('lamp', 'sage', 'sky', 'rose')
     or char_length(p_note) > 2000 then
    raise exception 'highlight_invalid' using errcode = '22023';
  end if;

  v_at := coalesce(p_at, now());
  if v_at > now() + interval '1 minute' then
    v_at := now();
  end if;
  v_created := least(coalesce(p_created_at, v_at), v_at);

  insert into public.reader_highlights as h
    (id, member_id, entry_id, file_hash, cfi, section_index, color, excerpt, note,
     created_at, updated_at, deleted_at)
  values
    (p_id, v_member, p_entry_id, p_file_hash, p_cfi, p_section_index, p_color,
     case when v_deleted then '' else left(coalesce(p_excerpt, ''), 1000) end,
     case when v_deleted then null else nullif(p_note, '') end,
     v_created, v_at,
     case when v_deleted then v_at end)
  on conflict (id) do update
    set file_hash     = excluded.file_hash,
        cfi           = excluded.cfi,
        section_index = excluded.section_index,
        color         = excluded.color,
        excerpt       = excluded.excerpt,
        note          = excluded.note,
        updated_at    = excluded.updated_at,
        deleted_at    = excluded.deleted_at
    where h.member_id = v_member
      and h.entry_id = excluded.entry_id
      and excluded.updated_at > h.updated_at
  returning h.* into v_row;

  -- Nothing was written: a newer change is stored already, and that one stands.
  if v_row.id is null then
    select * into v_row from public.reader_highlights
     where id = p_id and member_id = v_member and entry_id = p_entry_id;
    if not found then
      -- The id is in use for something that is not hers or not on this entry.
      raise exception 'highlight_invalid' using errcode = '22023';
    end if;
  end if;
  return v_row;
end;
$function$
;
