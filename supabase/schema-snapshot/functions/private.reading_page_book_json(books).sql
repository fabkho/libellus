CREATE OR REPLACE FUNCTION private.reading_page_book_json(p_book books)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
  select case when private.book_shown(p_book) then
    jsonb_build_object(
      'id', p_book.id,
      'title', p_book.title,
      'authors', to_jsonb(p_book.authors),
      'published_year', p_book.published_year,
      'cover_url', case when private.cover_shown(p_book) then p_book.cover_url end,
      'cover_thumbhash', case when private.cover_shown(p_book) then p_book.cover_thumbhash end,
      'cover_dominant', case when private.cover_shown(p_book) then p_book.cover_dominant end,
      'cover_secondary', case when private.cover_shown(p_book) then p_book.cover_secondary end,
      -- Our own copy of that cover (20261108010000, docs/plans/owned-covers.md §4): the image is
      -- c/<cover_key>/<width> for each of cover_widths. Gated as the URL is: a hidden cover hides its key too.
      'cover_key', case when private.cover_shown(p_book) then p_book.cover_key end,
      'cover_widths', case when private.cover_shown(p_book) then p_book.cover_widths end
    )
  else
    jsonb_build_object(
      'id', p_book.id,
      'title', null,
      'authors', '[]'::jsonb,
      'published_year', null,
      'cover_url', null,
      'cover_thumbhash', null,
      'cover_dominant', null,
      'cover_secondary', null,
      'cover_key', null,
      'cover_widths', null,
      'description', null,
      'unverified', true
    )
  end
$function$
;
