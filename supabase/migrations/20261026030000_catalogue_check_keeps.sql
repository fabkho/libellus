-- The check keeps what a Book has when its source says nothing (fix to 20261025020000_catalogue_check.sql).
--
-- catalogue_check_save wrote the cover, language, format, publisher and authors from the source's answer
-- alone, so a source with none of them (Apple's ebook records say no publisher, no language; Open Library
-- often no cover) replaced what the Book had, a cover the import's cover fill or a sibling edition supplied,
-- the language the import derived, with null. Now each is the source's when it has one, else the Book's own
-- (as page_count and published_year already were): coalesce(source's, stored). Everything the stored
-- column already satisfies (the cover is on the allow-list by books_cover_url_allowed) stays valid.
--
-- The cover's thumbhash and colours describe the picture they came with: kept only while the final cover is
-- the stored one (the source says nothing, or says the same URL), dropped when the source's cover differs.
-- The description stays the source's alone (null when it has none): only this function writes it, and
-- books_no_client_description keeps a client's out. Nothing else changes; catalogue_check_miss and
-- catalogue_check_mismatch are untouched. Idempotent: create or replace of the same signature, grants as they were.

-- Stores what the source says for a claimed Book, and marks it checked: a verified Book is the
-- source's, and what the source says wins. Where it says nothing the Book keeps its own (the cover, language,
-- format, publisher and authors an import, a cover fill or a sibling edition supplied), except the description:
-- that is the source's alone, null when it has none.
-- p_result:
--   title          text, 1–500 characters; required, and it must name the stored title's Book (a shared
--                  private.catalogue_title_forms; the function checks the identity; this is the second lock: a Book the source
--                  names otherwise is marked failed and nothing is written)
--   authors        text[], 1–20 names of at most 200 characters; else the Book's own ('{}' when it has none)
--   description    text of at most 10000 characters; else null
--   cover_url      https URL on private.cover_allowed's list (Open Library's covers, Apple's artwork, the Regal library); else the Book's own cover (a new
--                  URL drops the thumbhash and colours, which described another picture; the same one keeps them)
--   publisher      text of at most 200 characters; else the Book's own
--   language       two or three lower-case letters; else the Book's own
--   format         hardcover | paperback | ebook | audiobook; else the Book's own
--   page_count     1–10000; the source's, else the Book's own when it is in range, else null
--   published_year 1000–next year; the source's, else the Book's own when it is in range, else null
-- The function validates too; this is the second lock on the door, because the writer is a
-- service that reads other people's answers. Answers false when there was nothing to write: no such
-- Book, a Manual book, a Book already checked, a title that is not the Book's.
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
         cover_url = coalesce(v_cover, b.cover_url),
         -- The hash and colours describe the picture they came with: kept only while the cover is still that URL
         -- (the source says none, or says the same one); dropped when the source's cover is another picture.
         cover_thumbhash = case when v_cover is null or v_cover = b.cover_url then b.cover_thumbhash end,
         cover_dominant = case when v_cover is null or v_cover = b.cover_url then b.cover_dominant end,
         cover_secondary = case when v_cover is null or v_cover = b.cover_url then b.cover_secondary end,
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
