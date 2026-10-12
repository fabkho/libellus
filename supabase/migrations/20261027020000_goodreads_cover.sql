-- The Goodreads cover (last-resort cover source, docs/covers.md "Goodreads, the last resort").
--
-- The goodreads-rating edge function can be asked for a book's cover (`cover: true`): the address of
-- the edition's image at Goodreads' CDN (`i.gr-assets.com`), only ever linked, never copied. The two
-- answer caches remember it next to the rating they already hold, so the same title is not searched twice.
--
--   cover_url  null:  nobody has asked for the cover (every row that exists now)
--              '':    asked, Goodreads has none (a stand-in image)
--              else:  https://i.gr-assets.com/<path>, the full-size address (size token stripped)
--
-- `goodreads_ratings` (by ISBN) gets the column for the same shape; the function fills it only from the
-- title path today. Readable by every member and written by the service role, as the tables are.

alter table public.goodreads_title_ratings
  add column cover_url text,
  add constraint goodreads_title_ratings_cover_url check (
    cover_url is null or cover_url = '' or cover_url ~ '^https://i[.]gr-assets[.]com/[^?#[:space:]]*$'
  );

alter table public.goodreads_ratings
  add column cover_url text,
  add constraint goodreads_ratings_cover_url check (
    cover_url is null or cover_url = '' or cover_url ~ '^https://i[.]gr-assets[.]com/[^?#[:space:]]*$'
  );

comment on column public.goodreads_title_ratings.cover_url is
  'Goodreads'' cover address (i.gr-assets.com), linked never copied: null = not asked yet, '''' = Goodreads has none.';
comment on column public.goodreads_ratings.cover_url is
  'Goodreads'' cover address (i.gr-assets.com), linked never copied: null = not asked yet, '''' = Goodreads has none.';
