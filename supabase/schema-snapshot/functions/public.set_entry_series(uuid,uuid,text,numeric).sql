CREATE OR REPLACE FUNCTION public.set_entry_series(p_entry uuid, p_series uuid, p_name text, p_position numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_book uuid;
  v_series uuid;
  v_name text := nullif(btrim(p_name), '');
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  select book_id into v_book from public.library_entries where id = p_entry and member_id = v_member;
  if v_book is null then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if (p_series is not null and v_name is not null)
     or (p_series is null and v_name is null and p_position is not null)
     or p_position < 0 or p_position >= 10000
     or char_length(v_name) > 300 then
    raise exception 'series_invalid' using errcode = '22023';
  end if;

  if p_series is not null then
    select id into v_series from public.series
     where id = p_series and (created_by is null or created_by = v_member);
    if v_series is null then
      raise exception 'series_not_found' using errcode = 'P0002';
    end if;
  elsif v_name is not null then
    select id into v_series from public.series
     where lower(name) = lower(v_name) and (created_by is null or created_by = v_member)
     order by created_by is not null, wikidata_id is null, openlibrary_key is null, created_at
     limit 1;
    if v_series is null then
      insert into public.series (name, source, created_by)
      values (v_name, 'member', v_member)
      on conflict do nothing
      returning id into v_series;
      if v_series is null then
        select id into v_series from public.series where created_by = v_member and lower(name) = lower(v_name);
      end if;
    end if;
  end if;

  insert into public.entry_series (entry_id, member_id, series_id, position, updated_at)
  values (p_entry, v_member, v_series, round(p_position, 2), now())
  on conflict (entry_id) do update
     set series_id = excluded.series_id, position = excluded.position, updated_at = excluded.updated_at;

  return public.book_series_info(v_book);
end;
$function$
;
