-- A Goodreads import of 600 books as one member, six calls of 100 rows as the app sends them
-- (web/app/data/bookImport.ts), through import_books under RLS. Needs the seed (scripts/perf/seed.sql).
--   docker exec -i <db> psql -U postgres -v member=301 -v books=600 -f - < scripts/perf/import.sql
-- Prints the wall time of each call and of the whole import. The member is created here and
-- removed again at the end (its entries, sessions and activity go with it), so the script repeats.
\set ON_ERROR_STOP on
\if :{?books}
\else
  \set books 600
\endif
\if :{?member}
\else
  \set member 301
\endif
select md5('member' || :member)::uuid as mid \gset
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                        created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values (:'mid', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'import' || :member || '@perf.test',
        now(), '{}', '{"invite_code":"LIBELLUS-DEV"}', now(), now(), '', '', '', '') on conflict do nothing;
insert into public.accounts (id) values (:'mid') on conflict do nothing;

create temp table import_times (batch int, ms numeric);
grant all on import_times to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'mid', 'role', 'authenticated')::text, false);
set role authenticated;

select set_config('perf.books', :'books', false);
do $$
declare
  v_batch int; v_t timestamptz; v_rows jsonb; v_total timestamptz := clock_timestamp();
  v_books int := current_setting('perf.books')::int;
begin
  for v_batch in 0 .. (v_books / 100) - 1 loop
    select jsonb_agg(jsonb_build_object(
             'key', 'goodreads:' || (900000000 + i),
             'file_title', 'Imported book ' || i, 'file_author', 'Importer ' || (i % 60),
             'other_keys', '[]'::jsonb,
             'book', jsonb_build_object('title', 'Imported book ' || i, 'authors', jsonb_build_array('Importer ' || (i % 60)),
                                        'isbn13', '978' || lpad((900000000 + i)::text, 10, '0'), 'page_count', 200 + i % 300,
                                        'source', 'import'),
             'status', case when i % 10 < 8 then 'finished' when i % 10 = 8 then 'reading' else 'want_to_read' end,
             'started_on', case when i % 10 < 8 then (current_date - (i % 900) - 20)::text end,
             'ended_on', case when i % 10 < 8 then (current_date - (i % 900) - 5)::text end,
             'rating', case when i % 10 < 8 then 1 + i % 20 end,
             'review', case when i % 10 < 3 then 'A short review of imported book ' || i end,
             'outcome', null, 'added_on', (current_date - (i % 900) - 30)::text,
             'extra_reads', 0, 'earlier_reads', '[]'::jsonb, 'page_count', 200 + i % 300, 'collections', '[]'::jsonb))
      into v_rows from generate_series(v_batch * 100 + 1, v_batch * 100 + 100) i;
    v_t := clock_timestamp();
    perform public.import_books(v_rows);
    insert into import_times values (v_batch, extract(epoch from clock_timestamp() - v_t) * 1000);
  end loop;
  raise notice 'import of % books: % ms', v_books, round(extract(epoch from clock_timestamp() - v_total) * 1000);
end $$;
select batch, round(ms, 1) as ms from import_times order by batch;
reset role;
select 'entries' as what, count(*) from public.library_entries where member_id = :'mid'
union all select 'sessions', count(*) from public.reading_sessions s join public.library_entries e on e.id = s.entry_id where e.member_id = :'mid';
select to_regclass('public.activity') is not null as has_activity \gset
\if :has_activity
  select 'activity rows', count(*) from public.activity where member_id = :'mid';
\endif
-- Tidy: the member and everything of hers; the import Books stay in the Catalogue.
delete from auth.users where id = :'mid';
delete from public.books where isbn13 like '9780900%' and source = 'import';
