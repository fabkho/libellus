CREATE OR REPLACE FUNCTION private.enrich_work(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wd text := nullif(p ->> 'wikidata', '');
  v_ol text := nullif(p ->> 'openlibrary', '');
  v_title text := nullif(btrim(p ->> 'title'), '');
  v_id uuid;
  v_other uuid;
  v_ref jsonb;
  v_n integer := 0;
  v_series uuid;
  v_author uuid;
begin
  if v_wd is not null then
    select id into v_id from public.works where wikidata_id = v_wd;
  end if;
  if v_ol is not null then
    select id into v_other from public.works where openlibrary_key = v_ol;
  end if;
  if v_id is null then
    v_id := v_other;
  end if;
  if v_id is null then
    if v_title is null or (v_wd is null and v_ol is null) then
      return null;
    end if;
    insert into public.works (wikidata_id, openlibrary_key, title)
    values (v_wd, v_ol, left(v_title, 500))
    returning id into v_id;
  end if;

  update public.works w
     set wikidata_id = coalesce(w.wikidata_id,
                                case when not exists (select 1 from public.works o where o.wikidata_id = v_wd) then v_wd end),
         openlibrary_key = coalesce(w.openlibrary_key,
                                    case when v_other is null then v_ol end),
         title = coalesce(left(v_title, 500), w.title),
         titles = case when p ? 'titles' then w.titles || coalesce(p -> 'titles', '{}') else w.titles end,
         first_year = case when p ? 'year' then coalesce((p ->> 'year')::smallint, w.first_year) else w.first_year end,
         kind = case when p ? 'kind' then coalesce(p ->> 'kind', w.kind) else w.kind end,
         cover_url = case when p ? 'coverUrl' then coalesce(p ->> 'coverUrl', w.cover_url) else w.cover_url end,
         editions = case when p ? 'editions' then w.editions || coalesce(p -> 'editions', '{}') else w.editions end,
         genre_ids = case when jsonb_typeof(p -> 'genres') = 'array' and jsonb_array_length(p -> 'genres') > 0
                          then array(select jsonb_array_elements_text(p -> 'genres')) else w.genre_ids end,
         fetched_at = case when (p ->> 'fetched')::boolean then now() else w.fetched_at end
   where w.id = v_id;

  for v_ref in select * from jsonb_array_elements(coalesce(p -> 'authors', '[]')) loop
    v_n := v_n + 1;
    v_author := private.enrich_author(v_ref);
    if v_author is not null then
      insert into public.work_authors (work_id, author_id, position) values (v_id, v_author, v_n)
      on conflict (work_id, author_id) do nothing;
    end if;
  end loop;

  for v_ref in select * from jsonb_array_elements(coalesce(p -> 'series', '[]')) loop
    v_series := private.enrich_series(v_ref -> 'series');
    if v_series is not null then
      insert into public.work_series (work_id, series_id, position, source)
      values (v_id, v_series, round((v_ref ->> 'position')::numeric, 2), coalesce(v_ref ->> 'source', 'wikidata'))
      on conflict (work_id, series_id) do update
        set position = coalesce(excluded.position, public.work_series.position),
            source = case when excluded.position is not null then excluded.source else public.work_series.source end;
    end if;
  end loop;
  return v_id;
end;
$function$
;
