CREATE OR REPLACE FUNCTION private.enrich_series(p jsonb)
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
  v_parent uuid;
begin
  if v_wd is not null then
    select id into v_id from public.series where wikidata_id = v_wd;
  end if;
  if v_id is null and v_ol is not null then
    select id into v_id from public.series where openlibrary_key = v_ol;
  end if;
  if v_id is null and v_name is not null then
    select id into v_id from public.series
     where lower(name) = lower(v_name) and wikidata_id is null and openlibrary_key is null and created_by is null;
  end if;
  if v_id is null then
    if v_name is null then
      return null;
    end if;
    insert into public.series (name, wikidata_id, openlibrary_key, source)
    values (v_name, v_wd, v_ol, case when v_wd is not null then 'wikidata' else 'openlibrary' end)
    returning id into v_id;
  end if;

  if jsonb_typeof(p -> 'parent') = 'object' then
    v_parent := private.enrich_series(p -> 'parent');
  end if;

  update public.series s
     set wikidata_id = coalesce(s.wikidata_id,
                                case when not exists (select 1 from public.series o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(s.openlibrary_key,
                                    case when not exists (select 1 from public.series o where o.openlibrary_key = v_ol) then v_ol end),
         source = case when v_wd is not null then 'wikidata' else s.source end,
         name = case when v_wd is not null and v_name is not null then v_name else s.name end,
         parent_id = case when v_parent is not null and v_parent <> s.id then v_parent else s.parent_id end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else s.fetched_at end
   where s.id = v_id;
  return v_id;
end;
$function$
;
