CREATE OR REPLACE FUNCTION private.enrich_author(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wd text := nullif(p ->> 'wikidata', '');
  v_ol text := nullif(p ->> 'openlibrary', '');
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_id uuid;
begin
  if v_wd is not null then
    select id into v_id from public.authors where wikidata_id = v_wd;
  end if;
  if v_id is null and v_ol is not null then
    select id into v_id from public.authors where openlibrary_key = v_ol;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from public.authors
     where lower(name) = lower(v_name)
       and ((wikidata_id is null and openlibrary_key is null) or (v_wd is null and v_ol is null))
     order by wikidata_id is null, fetched_at is null, openlibrary_key is null, created_at
     limit 1;
  end if;

  if v_id is null then
    if v_name is null then
      return null;
    end if;
    insert into public.authors (wikidata_id, openlibrary_key, name)
    values (v_wd, v_ol, v_name)
    returning id into v_id;
  end if;

  update public.authors a
     set wikidata_id = coalesce(a.wikidata_id,
                                case when not exists (select 1 from public.authors o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(a.openlibrary_key,
                                    case when not exists (select 1 from public.authors o where o.openlibrary_key = v_ol) then v_ol end),
         name = case when p ? 'fetched' then coalesce(v_name, a.name) else a.name end,
         birth_date = case when p ? 'birthDate' then (p ->> 'birthDate')::date else a.birth_date end,
         birth_precision = case when p ? 'birthDate' then (p ->> 'birthPrecision')::smallint else a.birth_precision end,
         death_date = case when p ? 'deathDate' then (p ->> 'deathDate')::date else a.death_date end,
         death_precision = case when p ? 'deathDate' then (p ->> 'deathPrecision')::smallint else a.death_precision end,
         photo_url = case when p ? 'photoUrl' then p ->> 'photoUrl' else a.photo_url end,
         photo_credit = case when p ? 'photoUrl' then p -> 'photoCredit' else a.photo_credit end,
         summaries = case when p ? 'summaries' then coalesce(p -> 'summaries', '{}') else a.summaries end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else a.fetched_at end,
         works_fetched_at = case when (p ->> 'worksFetched')::boolean then now() else a.works_fetched_at end
   where a.id = v_id;
  return v_id;
end;
$function$
;
