CREATE OR REPLACE FUNCTION public.save_reader_place(p_entry_id uuid, p_cfi text, p_fraction real, p_file_hash text, p_at timestamp with time zone DEFAULT now())
 RETURNS reader_places
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_at     timestamptz;
  v_row    public.reader_places;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.library_entries e where e.id = p_entry_id and e.member_id = v_member
  ) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_cfi is null or char_length(p_cfi) not between 1 and 2000
     or p_fraction is null or p_fraction < 0 or p_fraction > 1
     or p_file_hash is null or p_file_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'place_invalid' using errcode = '22023';
  end if;

  v_at := coalesce(p_at, now());
  if v_at > now() + interval '1 minute' then
    v_at := now();
  end if;

  insert into public.reader_places as p (member_id, entry_id, cfi, fraction, file_hash, updated_at)
  values (v_member, p_entry_id, p_cfi, p_fraction, p_file_hash, v_at)
  on conflict (entry_id) do update
    set cfi        = excluded.cfi,
        fraction   = excluded.fraction,
        file_hash  = excluded.file_hash,
        updated_at = excluded.updated_at
    where excluded.updated_at > p.updated_at
  returning p.* into v_row;

  -- Nothing was written: a newer place is already stored. That one stands.
  if v_row.entry_id is null then
    select * into v_row from public.reader_places where entry_id = p_entry_id;
  end if;
  return v_row;
end;
$function$
;
