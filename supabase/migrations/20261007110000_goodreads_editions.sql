-- The edition a Goodreads export row means (issue #111).
--
-- A Goodreads export names every row by its Book Id, the exact edition the
-- member shelved, but very often has no ISBN at all (`=""`, every Kindle row).
-- So the import asks the `goodreads-rating` edge function what Goodreads knows
-- about that Book Id (supabase/functions/goodreads-rating), and the function
-- answers from this table when the id was read within the last 90 days (a miss
-- within 30), and otherwise reads the edition's page once, stores it here and
-- answers with it. A miss is stored too, so an id Goodreads does not show is
-- not asked about again for a month. A failed call (Goodreads down, slow,
-- refusing, redesigned) is never stored: the next import tries again.
--
-- Keyed by the Goodreads Book Id, the only thing an export row always has.
-- Only what identifies and describes the edition is kept: both ISBNs, the
-- ASIN, the language, how many pages, which binding, who published it and
-- when. No ratings (`goodreads_ratings` holds those), never review texts.
--
-- Nobody but the service role touches it: the table is the edge function's own
-- cache, members reach it only through the function's answer, so there are no
-- grants to anon or authenticated at all.

create table public.goodreads_editions (
  -- Goodreads' book id: the page is https://www.goodreads.com/book/show/<id>.
  goodreads_id   text primary key,
  -- 'found': Goodreads showed the edition; 'not_found': no such page, or a
  -- page that is not this edition's.
  status         text not null,
  title          text,
  -- The edition's own ISBNs, as printed: the 13 the Catalogue keys books by
  -- and the 10 older editions and Amazon still carry.
  isbn13         text,
  isbn10         text,
  -- Amazon's id: for a Kindle edition the only identifier there is.
  asin           text,
  -- ISO 639-1, mapped from Goodreads' language name; null when it names one we
  -- do not map.
  language       text,
  page_count     integer,
  -- Goodreads' own words: 'Kindle Edition', 'Paperback', 'Hardcover', …
  format         text,
  publisher      text,
  published_year smallint,
  checked_at     timestamptz not null default now(),

  constraint goodreads_editions_id_format check (goodreads_id ~ '^[0-9]{1,12}$'),
  constraint goodreads_editions_status check (status in ('found', 'not_found')),
  constraint goodreads_editions_isbn13_format check (isbn13 ~ '^97[89][0-9]{10}$'),
  constraint goodreads_editions_isbn10_format check (isbn10 ~ '^[0-9]{9}[0-9X]$'),
  constraint goodreads_editions_page_count check (page_count > 0),
  -- A miss knows nothing but its time.
  constraint goodreads_editions_miss_empty check (
    status = 'found' or (
      title is null and isbn13 is null and isbn10 is null and asin is null and language is null
      and page_count is null and format is null and publisher is null and published_year is null
    )
  )
);

comment on table public.goodreads_editions is
  'What Goodreads says about one edition, by its Book Id (issue #111), a cache the goodreads-rating '
  'edge function fills on demand for the Goodreads import and refreshes after 90 days (a miss after '
  '30). Written and read only by the service role; members see it through the function''s answer.';

-- An import matches its rows against the Catalogue by ISBN: found by it too.
create index goodreads_editions_isbn13 on public.goodreads_editions (isbn13)
  where isbn13 is not null;

-- ------------------------------------------------------------------------ RLS

alter table public.goodreads_editions enable row level security;

revoke all on public.goodreads_editions from anon, authenticated;
grant select, insert, update, delete on public.goodreads_editions to service_role;
