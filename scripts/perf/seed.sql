-- Synthetic data for the backend performance measurements (docs/perf/backend.md).
--
--   scripts/perf/seed.sh --members 30 --entries 150 --pool 2500
--
-- Throwaway stack only: the script TRUNCATES the Catalogue, every Library and every auth user it
-- finds. It refuses to run without `-v confirm=throwaway`.
--
-- Shape (the numbers come from production on 2026-10-09: 185 Books, 61 authors, 2,332 works,
-- 645 work_series rows, 139 series, 130 entries for one member):
--   pool            Catalogue Books (shared by all members; the popular third is picked twice as often)
--   authors         pool / 3
--   works           authors x 38 (an author's whole bibliography, as enrichment fetches it); the
--                   first `pool` works are the ones the Books are of
--   work_series     28 % of the works, in series of 5
--   members         `members` auth users, `entries` library entries each (a few less after
--                   duplicate picks), `heavy_entries` for member 1 (a Goodreads import)
--   entries         62 % finished, 5 % reading (open session + progress days), 28 % want to read,
--                   5 % abandoned; 15 % of the finished have a second read; a third of the
--                   closed reads carry a review
--
-- Triggers are off while it loads (session_replication_role = replica): statuses are written
-- by the script exactly as the derive trigger would, and `shelf_publish`/enrichment stay quiet.
\set ON_ERROR_STOP on
\if :{?confirm}
\else
  \echo 'refusing: pass -v confirm=throwaway (this truncates the Catalogue and every Library)'
  \quit
\endif
\if :{?members}
\else
  \set members 30
\endif
\if :{?entries}
\else
  \set entries 150
\endif
\if :{?pool}
\else
  \set pool 2500
\endif
\if :{?heavy_entries}
\else
  \set heavy_entries 0
\endif

\timing off
select setseed(0.42);
delete from auth.users;   -- cascades (triggers still on); the truncates below are for the rest
set session_replication_role = replica;
set client_min_messages = warning;


truncate public.books, public.authors, public.works, public.series, public.goodreads_ratings cascade;

-- ----------------------------------------------------------------- authors, works, series
create temp table perf_dims as
select :pool::int as pool,
       greatest(:pool / 3, 60) as n_auth,
       greatest(:pool / 3, 60) * 38 as n_works;

insert into public.authors (id, openlibrary_key, name, fetched_at, works_fetched_at)
select md5('author' || a)::uuid, 'OL' || (a + 100) || 'A', 'Author ' || a || ' Lastname', now(), now()
  from perf_dims, generate_series(1, (select n_auth from perf_dims)) a;

insert into public.works (id, openlibrary_key, wikidata_id, title, titles, first_year, kind, cover_url, genre_ids, fetched_at)
select md5('work' || w)::uuid, 'OL' || (w + 1000) || 'W', 'Q' || (w + 10),
       'Work title ' || w, jsonb_build_object('en', 'Work title ' || w, 'de', 'Werk ' || w),
       (1950 + w % 70)::smallint, 'novel', 'https://example.test/w' || w || '.jpg', '{}', now()
  from generate_series(1, (select n_works from perf_dims)) w;

insert into public.work_authors (work_id, author_id, position)
select md5('work' || w)::uuid, md5('author' || (((w - 1) % (select n_auth from perf_dims)) + 1))::uuid, 1
  from generate_series(1, (select n_works from perf_dims)) w;

-- 28 % of the works are in a series of five; the series' own rows.
create temp table perf_ws as
select w, row_number() over (order by w) as r
  from generate_series(1, (select n_works from perf_dims)) w
 where w % 7 in (0, 1);

insert into public.series (id, openlibrary_key, name, source, fetched_at)
select md5('series' || s)::uuid, 'OL' || (s + 500) || 'L', 'Series ' || s, 'openlibrary', now()
  from generate_series(1, (select (max(r) - 1) / 5 + 1 from perf_ws)) s;

insert into public.work_series (work_id, series_id, position, source)
select md5('work' || w)::uuid, md5('series' || ((r - 1) / 5 + 1))::uuid, ((r - 1) % 5) + 1, 'openlibrary'
  from perf_ws;

-- ----------------------------------------------------------------------- Catalogue Books
insert into public.books (id, title, authors, isbn13, page_count, published_year, language, publisher,
                          description, cover_url, cover_thumbhash, cover_dominant, cover_secondary,
                          source, apple_id)
select md5('book' || i)::uuid, 'Book title ' || i,
       array['Author ' || (((i - 1) % (select n_auth from perf_dims)) + 1) || ' Lastname'],
       '978' || lpad(i::text, 10, '0'), 120 + (i * 37) % 800, (1950 + i % 70)::smallint,
       case when i % 5 = 0 then 'de' else 'en' end, 'Publisher ' || (i % 40),
       repeat('A paragraph of the Book''s description, about as long as Apple''s blurb. ', 8 + i % 6),
       'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/' || i || '/600x900bb.jpg',
       '1QcSHQRnh493V4dIh4eXh1h4kJUI', '#3a5f8c', '#d9c9a0', 'apple', (1000000000 + i)::text
  from generate_series(1, :pool) i;

insert into public.book_authors (book_id, position, author_id)
select md5('book' || i)::uuid, 1, md5('author' || (((i - 1) % (select n_auth from perf_dims)) + 1))::uuid
  from generate_series(1, :pool) i;

insert into public.book_works (book_id, work_id, matched_by)
select md5('book' || i)::uuid, md5('work' || i)::uuid, 'isbn' from generate_series(1, :pool) i;

insert into public.book_genres (book_id, genre_id, rank, source, confidence, map_version)
select md5('book' || i)::uuid, g.id, g.n::smallint, 'wikidata', 0.8, 1
  from generate_series(1, :pool) i
  cross join lateral (select id, row_number() over (order by id) as n
                        from (select id from public.genres order by md5(id || i) limit 2) x) g;

insert into public.goodreads_ratings (isbn13, status, matched_by, goodreads_id, rating, ratings_count, reviews_count)
select '978' || lpad(i::text, 10, '0'), 'found', 'isbn', (5000000 + i)::text,
       round((3 + random() * 2)::numeric, 2), (random() * 90000)::int, (random() * 9000)::int
  from generate_series(1, :pool) i where i % 10 < 7;

insert into public.book_enrichment (book_id, status, sources)
select md5('book' || i)::uuid, 'enriched', '{wikidata}' from generate_series(1, :pool) i;

-- ------------------------------------------------------------------------------- members
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data,
                        raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select md5('member' || m)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'member' || m || '@perf.test', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(),
       '', '', '', ''
  from generate_series(1, :members) m;
insert into public.accounts (id) select md5('member' || m)::uuid from generate_series(1, :members) m;

-- ----------------------------------------------------------------------------- entries
-- Popular Books (the first third of the pool) are picked about twice as often.
create temp table perf_entries on commit preserve rows as
select distinct on (m, book_i)
       m, book_i, md5('member' || m)::uuid as member_id, md5('book' || book_i)::uuid as book_id,
       md5('entry' || m || '/' || book_i)::uuid as id,
       (now() - (random() * 1000 || ' days')::interval) as added_at, random() as roll, random() as roll2
  from (select m, i,
               case when random() < 0.5 then 1 + floor(random() * greatest(:pool / 3, 1))::int
                    else 1 + floor(random() * :pool)::int end as book_i
          from generate_series(1, :members) m,
               lateral generate_series(1, case when m = 1 and :heavy_entries > 0 then :heavy_entries else :entries end) i) p
 order by m, book_i;

alter table perf_entries add column kind text;
update perf_entries set kind = case when roll < 0.62 then 'finished' when roll < 0.67 then 'reading'
                                    when roll < 0.95 then 'want' else 'abandoned' end;

insert into public.library_entries (id, member_id, book_id, status, added_at)
select id, member_id, book_id,
       case kind when 'finished' then 'finished' when 'abandoned' then 'finished'
                 when 'reading' then 'reading' else 'want_to_read' end::public.entry_status,
       added_at
  from perf_entries;

-- ---------------------------------------------------------------------------- sessions
create temp table perf_sessions on commit preserve rows as
select e.*, n,
       (current_date - (random() * 1000)::int - 3) as ended
  from perf_entries e
  cross join lateral generate_series(1, case when e.kind = 'finished' and e.roll2 < 0.15 then 2 else 1 end) n
 where e.kind in ('finished', 'abandoned');

insert into public.reading_sessions (id, entry_id, started_on, ended_on, outcome, rating, review, abandon_reason, created_at)
select md5('session' || id || '/' || n)::uuid, id, ended - (3 + (random() * 40)::int), ended,
       case when kind = 'abandoned' then 'abandoned' else 'finished' end::public.session_outcome,
       case when kind = 'finished' and random() < 0.8 then 1 + (random() * 19)::int end,
       case when kind = 'finished' and random() < 0.33 then repeat('A sentence of a review. ', 6 + (random() * 14)::int) end,
       case when kind = 'abandoned' then 'lost the thread' end,
       ended::timestamptz
  from perf_sessions;

insert into public.reading_sessions (id, entry_id, started_on, outcome, progress_percent, progress_updated_at, created_at)
select md5('open' || id)::uuid, id, current_date - (1 + (random() * 40)::int), null,
       (random() * 90)::int, now(), now()
  from perf_entries where kind = 'reading';

-- Progress days: every open session, and a tenth of the finished ones.
insert into public.reading_progress_days (session_id, day, start_percent, end_percent)
select s.id, d.day, ((n - 1) * 10)::smallint, (n * 10)::smallint
  from public.reading_sessions s
  join public.library_entries e on e.id = s.entry_id
  cross join lateral (select generate_series(1, 4 + (random() * 4)::int) n) k
  cross join lateral (select (coalesce(s.ended_on, current_date) - (8 - k.n)) as day) d
 where (s.outcome is null or s.id::text < '1')
   and d.day >= s.started_on
on conflict do nothing;

-- A few muted series, a few member series' positions.
insert into public.muted_series (member_id, series_id)
select member_id, md5('series' || (1 + (random() * 50)::int))::uuid from perf_entries where kind = 'reading' and roll2 < 0.1
on conflict do nothing;

reset session_replication_role;
do $$ declare t regclass; begin
  for t in select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where c.relkind = 'r' and n.nspname in ('public', 'private') loop
    execute format('analyze %s', t);
  end loop;
end $$;

select 'members' as what, count(*) from auth.users union all
select 'books', count(*) from public.books union all
select 'works', count(*) from public.works union all
select 'work_series', count(*) from public.work_series union all
select 'entries', count(*) from public.library_entries union all
select 'sessions', count(*) from public.reading_sessions union all
select 'progress_days', count(*) from public.reading_progress_days;
