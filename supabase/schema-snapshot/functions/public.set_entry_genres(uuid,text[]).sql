CREATE OR REPLACE FUNCTION public.set_entry_genres(p_entry uuid, p_genres text[])
 RETURNS SETOF text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_member uuid := auth.uid();
  v_genres text[];
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not exists (select 1 from public.library_entries where id = p_entry and member_id = v_member) then
    raise exception 'entry_not_found' using errcode = 'P0002';
  end if;
  if p_genres is null or array_position(p_genres, null) is not null then
    raise exception 'genres_invalid' using errcode = '22023';
  end if;

  select coalesce(array_agg(id order by first_at), '{}') into v_genres
    from (select btrim(g) as id, min(n) as first_at
            from unnest(p_genres) with ordinality as t(g, n)
           group by btrim(g)) d;

  if cardinality(v_genres) > 3
     or exists (select 1 from unnest(v_genres) g where not exists (select 1 from public.genres where id = g)) then
    raise exception 'genres_invalid' using errcode = '22023';
  end if;

  insert into public.entry_genres (entry_id, member_id, genre_ids, updated_at)
  values (p_entry, v_member, v_genres, now())
  on conflict (entry_id) do update set genre_ids = excluded.genre_ids, updated_at = excluded.updated_at;

  return query select unnest(v_genres);
end;
$function$
;
