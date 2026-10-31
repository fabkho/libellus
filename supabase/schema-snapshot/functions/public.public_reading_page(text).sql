CREATE OR REPLACE FUNCTION public.public_reading_page(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_page   public.reading_pages;
  v_result jsonb;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;

  v_result := jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'sections', jsonb_build_object(
      'reading', v_page.show_reading, 'year', v_page.show_year, 'favourites', v_page.show_favourites,
      'finished', v_page.show_finished, 'shelf', v_page.show_shelf));

  if v_page.show_reading then
    v_result := v_result || jsonb_build_object('reading', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'started_on', r.started_on)
                                order by r.started_on desc nulls last), '[]'::jsonb)
        from private.reading_page_reading(v_page.member_id) r join public.books b on b.id = r.book_id));
  end if;

  if v_page.show_year then
    v_result := v_result || jsonb_build_object('year', private.reading_page_year(v_page.member_id));
  end if;

  if v_page.show_favourites then
    v_result := v_result || jsonb_build_object('favourites', (
      select coalesce(jsonb_agg(jsonb_build_object('book', private.reading_page_book_json(b), 'rating', f.rating)
                                order by f.rating desc, f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_favourites(v_page.member_id) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_finished then
    v_result := v_result || jsonb_build_object('finished', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'book', private.reading_page_book_json(b), 'ended_on', f.ended_on, 'rating', f.rating,
               'review', private.reading_page_review(v_page.member_id, f.book_id, f.review),
               'spoilers', coalesce(private.reading_page_review(v_page.member_id, f.book_id, f.review) is not null
                                    and f.review_spoilers, false),
               'folded', coalesce(private.reading_page_review(v_page.member_id, f.book_id, f.review) is not null
                                  and private.review_folded(auth.uid(), v_page.member_id, f.book_id, f.review_spoilers), false))
             order by f.ended_on desc nulls last), '[]'::jsonb)
        from private.reading_page_finished(v_page.member_id, 12) f join public.books b on b.id = f.book_id));
  end if;

  if v_page.show_shelf then
    if private.reading_page_has_regal(v_page.member_id) then
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'regal'));
    else
      v_result := v_result || jsonb_build_object('shelf', jsonb_build_object('kind', 'covers', 'books', (
        select coalesce(jsonb_agg(private.reading_page_book_json(b) order by f.ended_on desc nulls last), '[]'::jsonb)
          from private.reading_page_finished(v_page.member_id, 60) f join public.books b on b.id = f.book_id)));
    end if;
  end if;

  return v_result;
end;
$function$
;
