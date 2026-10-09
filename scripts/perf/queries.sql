-- The hot queries of the app as SQL (the SQL PostgREST builds for the repository calls in
-- web/app/data/*.ts, or the function the RPC calls). One `-- name:` line starts each; `:m` is the
-- member's uuid, `:book`/`:series`/`:author` are picked by explain.mjs from her data.
-- name: home.list.want_to_read
select json_agg(t) from (select e.id, e.status, e.added_at, e.page_count_override, e.format_override, e.read_as, row_to_json(b)::jsonb as book, row_to_json(l)::jsonb as latest from public.library_entries e join lateral (select b1.*, row_to_json(g)::jsonb as goodreads from public.books b1 left join lateral (select g1.* from public.goodreads_rating(b1) g1 limit 1) g on true where b1.id = e.book_id limit 1) b on true left join lateral (select s.* from public.latest_session(e) s limit 1) l on true where e.status = 'want_to_read' /*e:e*/ order by e.added_at desc) t
-- name: home.list.finished
select json_agg(t) from (select e.id, e.status, e.added_at, e.page_count_override, e.format_override, e.read_as, row_to_json(b)::jsonb as book, row_to_json(l)::jsonb as latest from public.library_entries e join lateral (select b1.*, row_to_json(g)::jsonb as goodreads from public.books b1 left join lateral (select g1.* from public.goodreads_rating(b1) g1 limit 1) g on true where b1.id = e.book_id limit 1) b on true left join lateral (select s.* from public.latest_session(e) s limit 1) l on true where e.status = 'finished' /*e:e*/ order by l.ended_on desc nulls last, e.added_at desc) t
-- name: home.readInYear
select count(*) from public.reading_sessions where outcome = 'finished' and ended_on >= date_trunc('year', current_date) and ended_on <= current_date /*en:entry_id*/
-- name: home.started_series
select public.started_series(50, 'en')
-- name: home.muted_series_list
select public.muted_series_list(50, 'en')
-- name: library.library_genres
select count(*) from public.library_genres()
-- name: profile.sessions
select json_agg(t) from (select s.id, s.entry_id, s.started_on, s.ended_on, s.outcome, s.rating, s.created_at, row_to_json(e) as entry from public.reading_sessions s join lateral (select e1.page_count_override, row_to_json(b) as book from public.library_entries e1 join lateral (select b1.*, row_to_json(g)::jsonb as goodreads from public.books b1 left join lateral (select g1.* from public.goodreads_rating(b1) g1 limit 1) g on true where b1.id = e1.book_id) b on true where e1.id = s.entry_id /*e:e1*/) e on true where s.outcome is not null order by s.id limit 1000) t
-- name: profile.counts
select (select count(*) from public.library_entries e where status = 'want_to_read' /*e:e*/) w, (select count(*) from public.library_entries e where status = 'reading' /*e:e*/) r
-- name: profile.progress_days_83d
select count(*) from public.reading_progress_days d join public.reading_sessions s on s.id = d.session_id where d.day >= current_date - 83 and d.day <= current_date /*en:s.entry_id*/
-- name: profile.days_since
select day from public.reading_progress_days d where true /*sess:d.session_id*/ order by day limit 1
-- name: search.title_prefix
select count(*) from public.search_books('book title 1', 20)
-- name: search.author
select count(*) from public.search_books('author 7 lastname', 20)
-- name: search.two_letters
select count(*) from public.search_books('bo', 20)
-- name: book.series_info
select public.book_series_info(:'book', 'en')
-- name: book.authors_of
select * from public.book_authors_of(:'book')
-- name: book.genres
select * from public.book_genres(:'book')
-- name: series.series_works
select public.series_works(:'series', 'en')
-- name: author.author_page
select public.author_page(:'author', 'en')
-- name: next.next_in_series
select public.next_in_series(5, 'en')
-- name: next.my_works
select count(*) from public.my_works()
