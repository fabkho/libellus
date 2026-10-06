-- import_books with the dated earlier reads of a Hardcover export (#111):
--   supabase test db
--
-- Earlier reads with their days, as finished sessions before the row's own
-- (which stays the latest); undated extra reads after them; refusals for an
-- earlier read that ends before it starts, too many reads, reads on Want to
-- read, and a value that is no list of reads. And two apps' exports of one
-- library: a Hardcover row of a book a Goodreads row brought in adds no
-- second entry and no read. Assertions act as a real signed-in member.

begin;
select plan(10);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-HC-READS', 'hardcover reads test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-HC-READS"}'::jsonb, now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.outcomes(p_results jsonb)
returns text[] language sql as $$
  select array_agg(coalesce(r->>'error', r->>'outcome') order by n)
    from jsonb_array_elements(p_results) with ordinality as t(r, n)
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('mara@hardcover-reads.test') as mara_id \gset

select tests.act_as(:'mara_id');

select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:501", "book": {"title": "Twice Read", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "started_on": "2023-05-01", "ended_on": "2023-05-20", "rating": 18,
     "earlier_reads": [{"started_on": "2019-01-02", "ended_on": "2019-02-01"}, {"started_on": null, "ended_on": "2021-07-07"}]},
    {"key": "hardcover:502", "book": {"title": "Again Now", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2025-01-01",
     "earlier_reads": [{"started_on": "2020-03-01", "ended_on": "2020-03-30"}], "extra_reads": 1},
    {"key": "hardcover:503", "book": {"title": "Backwards", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "earlier_reads": [{"started_on": "2020-03-30", "ended_on": "2020-03-01"}]},
    {"key": "hardcover:504", "book": {"title": "Too Often", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "extra_reads": 20, "earlier_reads": [{"ended_on": "2020-03-01"}]},
    {"key": "hardcover:505", "book": {"title": "Only Wished", "authors": ["Ida Example"], "source": "manual"},
     "status": "want_to_read", "earlier_reads": [{"ended_on": "2020-03-01"}]},
    {"key": "hardcover:506", "book": {"title": "Odd Reads", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "earlier_reads": ["2020-03-01"]},
    {"key": "hardcover:507", "book": {"title": "No List", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "earlier_reads": {"ended_on": "2020-03-01"}}
  ] $$)),
  array['added', 'added', 'ended_before_started', 'session_invalid', 'session_invalid', 'session_invalid', 'session_invalid'],
  'dated earlier reads are taken; what cannot be is refused per row');

select results_eq(
  $$ select s.import_key, s.started_on::text, s.ended_on::text, s.outcome::text, s.rating::integer
       from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
      where e.import_key = 'hardcover:501' order by s.created_at $$,
  $$ values ('hardcover:501#2', '2019-01-02', '2019-02-01', 'finished', null::integer),
            ('hardcover:501#3', null, '2021-07-07', 'finished', null),
            ('hardcover:501', '2023-05-01', '2023-05-20', 'finished', 18) $$,
  'every read with its days, oldest first, the row''s own last');

select is(
  (select s.import_key from public.library_entries e, public.latest_session(e) s where e.import_key = 'hardcover:501'),
  'hardcover:501', 'the row''s own read stays the latest, with its rating');

select results_eq(
  $$ select s.import_key, s.ended_on::text, s.outcome::text
       from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
      where e.import_key = 'hardcover:502' order by s.created_at $$,
  $$ values ('hardcover:502#2', '2020-03-30', 'finished'),
            ('hardcover:502#3', null, 'finished'),
            ('hardcover:502', null, null) $$,
  'a book read again now: the dated read, the undated one, then the open read');

select is(
  (select status::text from public.library_entries where import_key = 'hardcover:502'),
  'reading', 'and it is Currently reading');

select is(
  (select count(*)::int from public.library_entries where member_id = :'mara_id' and import_key like 'hardcover:50_'),
  2, 'refused rows leave no entry');

-- The same file again adds nothing: no second read either.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:501", "book": {"title": "Twice Read", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "started_on": "2023-05-01", "ended_on": "2023-05-20",
     "earlier_reads": [{"started_on": "2019-01-02", "ended_on": "2019-02-01"}]}
  ] $$)),
  array['imported'], 'the same Hardcover row again is imported already');

-- Goodreads first, then Hardcover's export of the same library.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "goodreads:9001", "file_title": "Shared Shelf", "file_author": "Nora Vale",
     "book": {"title": "Shared Shelf", "authors": ["Nora Vale"], "source": "manual"},
     "status": "finished", "ended_on": "2024-03-09", "rating": 16}
  ] $$)),
  array['added'], 'a Goodreads row brings the book');

select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:9001", "file_title": "Shared Shelf", "file_author": "Nora Vale",
     "book": {"title": "Shared Shelf", "authors": ["Nora Vale"], "source": "manual"},
     "status": "finished", "started_on": "2024-02-20", "ended_on": "2024-03-09", "rating": 18,
     "earlier_reads": [{"ended_on": "2019-01-01"}]}
  ] $$)),
  array['in_library'], 'a Hardcover row of the same book is in her Library already');

select is(
  (select count(*)::int from public.reading_sessions s join public.library_entries e on e.id = s.entry_id
    where e.member_id = :'mara_id' and e.import_key = 'goodreads:9001'),
  1, 'and adds no read to it');

select * from finish();
rollback;
