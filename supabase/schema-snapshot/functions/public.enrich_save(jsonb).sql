CREATE OR REPLACE FUNCTION public.enrich_save(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_item jsonb;
  v_book jsonb := p_payload -> 'book';
  v_book_id uuid := (p_payload -> 'book' ->> 'id')::uuid;
  v_work uuid;
  v_author uuid;
  v_authors uuid[] := '{}';
begin
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'authors', '[]')) loop
    v_author := private.enrich_author(v_item);
    if v_author is not null then
      v_authors := v_authors || v_author;
    end if;
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'series', '[]')) loop
    perform private.enrich_series(v_item);
  end loop;
  for v_item in select * from jsonb_array_elements(coalesce(p_payload -> 'works', '[]')) loop
    perform private.enrich_work(v_item);
  end loop;

  if v_book_id is null then
    return jsonb_build_object('authors', to_jsonb(v_authors));
  end if;
  if not exists (select 1 from public.books where id = v_book_id and owner_id is null) then
    delete from private.enrich_queue where book_id = v_book_id;
    return jsonb_build_object('book', null);
  end if;

  if jsonb_typeof(v_book -> 'work') = 'object' then
    v_work := private.enrich_work(v_book -> 'work');
  end if;
  delete from public.book_works where book_id = v_book_id;
  if v_work is not null then
    insert into public.book_works (book_id, work_id, matched_by)
    values (v_book_id, v_work, coalesce(v_book ->> 'matchedBy', 'openlibrary'));
  end if;

  v_authors := '{}';
  delete from public.book_authors where book_id = v_book_id;
  for v_item in select * from jsonb_array_elements(coalesce(v_book -> 'authors', '[]')) loop
    v_author := private.enrich_author(v_item -> 'author');
    if v_author is not null then
      insert into public.book_authors (book_id, position, author_id)
      values (v_book_id, (v_item ->> 'position')::smallint, v_author)
      on conflict (book_id, position) do nothing;
      v_authors := v_authors || v_author;
      if v_work is not null then
        insert into public.work_authors (work_id, author_id, position)
        values (v_work, v_author, (v_item ->> 'position')::smallint)
        on conflict (work_id, author_id) do nothing;
      end if;
    end if;
  end loop;

  if jsonb_typeof(v_book -> 'genres') = 'array' then
    delete from public.book_genres where book_id = v_book_id;
    insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
    select v_book_id, g ->> 'genre', (g ->> 'rank')::smallint, g ->> 'source', (g ->> 'confidence')::real,
           (v_book ->> 'mapVersion')::integer
      from jsonb_array_elements(v_book -> 'genres') g;
  end if;

  insert into public.book_enrichment (book_id, status, sources, signals, map_version, enriched_at)
  values (v_book_id,
          coalesce(v_book ->> 'status', 'enriched'),
          array(select jsonb_array_elements_text(coalesce(v_book -> 'sources', '[]'))),
          coalesce(v_book -> 'signals', '[]'),
          (v_book ->> 'mapVersion')::integer,
          now())
  on conflict (book_id) do update
    set status = excluded.status, sources = excluded.sources, signals = excluded.signals,
        map_version = excluded.map_version, enriched_at = excluded.enriched_at;

  delete from private.enrich_queue where book_id = v_book_id;
  return jsonb_build_object('book', v_book_id, 'work', v_work, 'authors', to_jsonb(v_authors));
end;
$function$
;
