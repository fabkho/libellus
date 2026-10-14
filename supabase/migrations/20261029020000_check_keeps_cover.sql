-- One Book, one cover (docs/plans/covers-consistency.md), part two.
--
-- catalogue_check_save: the check (pg_cron, every minute) wrote the source's cover over the one the Book
-- entered with, about a minute after a member added it, and dropped its thumbhash and colours: rows kept
-- alive on her device still showed the first picture while the Book's page showed the new one, and an Open
-- Library Book whose cover the add had taken from Apple (900 px, the very edition) went back to Open
-- Library's 500 px one. On production 23 of 62 Open Library Books carry a cover without its thumbhash; 19
-- of them are exactly what the check's rule picks (the edition's first cover, else the work's). Now the
-- check keeps a Book's cover and only fills a missing one, as fill_book_covers does; everything else it
-- writes is unchanged. Idempotent: create or replace of the same signatures, grants as they were.

-- Stores what the source says for a claimed Book, and marks it checked (20261026030000_catalogue_check_keeps.sql),
-- except the cover: the Book's own stays, the source's fills a missing one.
create or replace function public.catalogue_check_save(p_book uuid, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_book        public.books;
  v_title       text;
  v_authors     text[];
  v_description text;
  v_cover       text;
  v_publisher   text;
  v_language    text;
  v_format      public.book_format;
  v_pages       integer;
  v_year        integer;
  v_max_year    integer := extract(year from now())::integer + 1;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' then
    raise exception 'result_invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(p_result -> 'title') = 'string' then
    v_title := btrim(p_result ->> 'title');
  end if;
  if v_title is null or char_length(v_title) not between 1 and 500 then
    raise exception 'result_invalid' using errcode = '22023';
  end if;

  select * into v_book
    from public.books b
   where b.id = p_book and b.owner_id is null and b.checked_at is null
     for update;
  if not found then
    delete from private.catalogue_check_state where book_id = p_book;
    return false;
  end if;

  -- The source's record must be this Book's: the first member's title is the key the check was
  -- asked by (a real ISBN with another Book's id would otherwise write the other Book under it).
  if not private.catalogue_title_forms(v_book.title) && private.catalogue_title_forms(v_title) then
    perform public.catalogue_check_mismatch(p_book);
    return false;
  end if;

  if jsonb_typeof(p_result -> 'authors') = 'array'
     and jsonb_array_length(p_result -> 'authors') between 1 and 20
     and not exists (select 1 from jsonb_array_elements(p_result -> 'authors') a
                      where jsonb_typeof(a) <> 'string' or char_length(btrim(a #>> '{}')) not between 1 and 200) then
    select array_agg(btrim(a #>> '{}') order by n) into v_authors
      from jsonb_array_elements(p_result -> 'authors') with ordinality as t(a, n);
  end if;

  if jsonb_typeof(p_result -> 'description') = 'string'
     and char_length(p_result ->> 'description') <= 10000 then
    v_description := nullif(btrim(p_result ->> 'description'), '');
  end if;

  if jsonb_typeof(p_result -> 'cover_url') = 'string'
     and char_length(p_result ->> 'cover_url') <= 500
     and (p_result ->> 'cover_url') !~ '[[:space:]]'
     -- The one allow-list (20261022010000): a cover off it is no cover (the books CHECK would refuse the whole update).
     and private.cover_allowed(p_result ->> 'cover_url') then
    v_cover := p_result ->> 'cover_url';
  end if;

  if jsonb_typeof(p_result -> 'publisher') = 'string'
     and char_length(btrim(p_result ->> 'publisher')) between 1 and 200 then
    v_publisher := btrim(p_result ->> 'publisher');
  end if;

  if jsonb_typeof(p_result -> 'language') = 'string' and (p_result ->> 'language') ~ '^[a-z]{2,3}$' then
    v_language := p_result ->> 'language';
  end if;

  if jsonb_typeof(p_result -> 'format') = 'string'
     and (p_result ->> 'format') in ('hardcover', 'paperback', 'ebook', 'audiobook') then
    v_format := (p_result ->> 'format')::public.book_format;
  end if;

  -- Pages and year: the source's when it has them, else the Book's own, if plausible.
  if jsonb_typeof(p_result -> 'page_count') = 'number' and (p_result ->> 'page_count') ~ '^[0-9]{1,5}$'
     and (p_result ->> 'page_count')::integer between 1 and 10000 then
    v_pages := (p_result ->> 'page_count')::integer;
  elsif v_book.page_count between 1 and 10000 then
    v_pages := v_book.page_count;
  end if;

  if jsonb_typeof(p_result -> 'published_year') = 'number' and (p_result ->> 'published_year') ~ '^[0-9]{1,4}$'
     and (p_result ->> 'published_year')::integer between 1000 and v_max_year then
    v_year := (p_result ->> 'published_year')::integer;
  elsif v_book.published_year between 1000 and v_max_year then
    v_year := v_book.published_year;
  end if;

  update public.books b
     set title = v_title,
         authors = coalesce(v_authors, b.authors, '{}'),
         description = v_description,
         -- One Book, one cover: the Book's own cover stays, the source's only fills a missing one (as
         -- fill_book_covers does). Its hash and colours stay with it; a filled cover has none yet.
         cover_url = coalesce(b.cover_url, v_cover),
         cover_thumbhash = case when b.cover_url is not null then b.cover_thumbhash end,
         cover_dominant = case when b.cover_url is not null then b.cover_dominant end,
         cover_secondary = case when b.cover_url is not null then b.cover_secondary end,
         publisher = coalesce(v_publisher, b.publisher),
         language = coalesce(v_language, b.language),
         format = coalesce(v_format, b.format),
         page_count = v_pages,
         published_year = v_year,
         checked_at = now(),
         check_failed = false
   where b.id = p_book;

  delete from private.catalogue_check_state where book_id = p_book;
  return true;
end;
$$;

