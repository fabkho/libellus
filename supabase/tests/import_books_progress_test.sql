-- import_books with the progress of a Hardcover zip (docs/plans/hardcover-zip.md, PR 2):
--   supabase test db
--
-- A row may carry `progress`: { "page": n } or { "percent": n }, exactly one, whole numbers in range, only on a read that is open
-- (Currently reading) or abandoned. It is stored as what Libellus keeps of a read's place (progress_page or progress_percent,
-- never both, and progress_updated_at), a page past the Book's page count (or her own total) is cut back to it, and an import
-- writes NO reading_progress_days row. Every other row shape is as before: a CSV row has no `progress`. Assertions act as a real
-- signed-in member.

begin;
select plan(19);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-HC-PROGRESS', 'hardcover progress test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-HC-PROGRESS"}'::jsonb, now(), now(), now());
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

-- The place stored for a row's own session: 'page 12', 'percent 40', or 'none'.
create or replace function tests.place(p_key text)
returns text language sql as $$
  select case when s.progress_page is not null then 'page ' || s.progress_page
              when s.progress_percent is not null then 'percent ' || s.progress_percent
              else 'none' end
    from public.reading_sessions s where s.import_key = p_key
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('mara@hardcover-progress.test') as mara_id \gset
select tests.member('noor@hardcover-progress.test') as noor_id \gset

select tests.act_as(:'mara_id');

select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:701", "book": {"title": "Open Page", "authors": ["Ida Example"], "source": "manual", "page_count": 300},
     "status": "reading", "started_on": "2026-09-01", "progress": {"page": 120}},
    {"key": "hardcover:702", "book": {"title": "Open Percent", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-02", "progress": {"percent": 40}},
    {"key": "hardcover:703", "book": {"title": "Stopped Page", "authors": ["Ida Example"], "source": "manual", "page_count": 250},
     "status": "finished", "outcome": "abandoned", "started_on": "2026-01-02", "ended_on": "2026-02-03", "progress": {"page": 90}},
    {"key": "hardcover:704", "book": {"title": "Stopped Percent", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "outcome": "abandoned", "progress": {"percent": 15}},
    {"key": "hardcover:705", "book": {"title": "Past The End", "authors": ["Ida Example"], "source": "manual", "page_count": 200},
     "status": "reading", "started_on": "2026-09-03", "progress": {"page": 450}},
    {"key": "hardcover:706", "book": {"title": "No Progress", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-04"},
    {"key": "hardcover:707", "book": {"title": "Null Progress", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-05", "progress": null}
  ] $$)),
  array['added', 'added', 'added', 'added', 'added', 'added', 'added'],
  'open and abandoned reads take progress; a row without it, or with null, is as before');

select is(tests.place('hardcover:701'), 'page 120', 'an open read keeps its page');
select is(tests.place('hardcover:702'), 'percent 40', 'or its percent, never both');
select is(tests.place('hardcover:703'), 'page 90', 'an abandoned read keeps the page she stopped at');
select is(tests.place('hardcover:704'), 'percent 15', 'or the percent');
select is(tests.place('hardcover:705'), 'page 200', 'a page past the Book''s page count is cut back to the last page');
select is(tests.place('hardcover:706'), 'none', 'a row without progress has none');
select is(tests.place('hardcover:707'), 'none', 'and one with a null progress');
select ok(
  (select bool_and((s.progress_updated_at is not null) = (s.progress_page is not null or s.progress_percent is not null))
     from public.reading_sessions s where s.import_key between 'hardcover:701' and 'hardcover:707'),
  'progress_updated_at is set exactly when there is progress');
select is((select count(*)::int from public.reading_progress_days), 0, 'an import writes no reading day');

-- Her own page total (the row's page_count, when the edition says another) is the one a page is cut to.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:711", "book": {"title": "Her Total", "authors": ["Ida Example"], "source": "manual", "page_count": 500},
     "page_count": 150, "status": "reading", "started_on": "2026-09-06", "progress": {"page": 400}}
  ] $$)),
  array['added'], 'a row with her own page total');
select is(tests.place('hardcover:711'), 'page 150', 'a page past her own total is cut to it');

-- What is refused, per row (the others stand).
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:721", "book": {"title": "Both Kinds", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"page": 10, "percent": 5}},
    {"key": "hardcover:722", "book": {"title": "Over A Hundred", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"percent": 101}},
    {"key": "hardcover:723", "book": {"title": "Negative", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"page": -1}},
    {"key": "hardcover:724", "book": {"title": "Huge", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"page": 100000}},
    {"key": "hardcover:725", "book": {"title": "Half A Page", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"page": 12.5}},
    {"key": "hardcover:726", "book": {"title": "Text", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"page": "12"}},
    {"key": "hardcover:727", "book": {"title": "Not An Object", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": 12},
    {"key": "hardcover:728", "book": {"title": "Seconds", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"seconds": 600}},
    {"key": "hardcover:729", "book": {"title": "Empty Object", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {}},
    {"key": "hardcover:730", "book": {"title": "Fine After", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-07", "progress": {"percent": 100}}
  ] $$)),
  array['progress_invalid', 'progress_invalid', 'progress_invalid', 'progress_invalid', 'progress_invalid', 'progress_invalid',
        'progress_invalid', 'progress_invalid', 'progress_invalid', 'added'],
  'both kinds, out of range, not whole, not a number, not an object, another unit: refused per row; a valid row after them stands');

select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:741", "book": {"title": "Wished", "authors": ["Ida Example"], "source": "manual"},
     "status": "want_to_read", "progress": {"page": 10}},
    {"key": "hardcover:742", "book": {"title": "Done", "authors": ["Ida Example"], "source": "manual"},
     "status": "finished", "ended_on": "2026-01-01", "progress": {"page": 10}}
  ] $$)),
  array['session_invalid', 'session_invalid'],
  'progress only on a read that is open or abandoned: not on Want to read, not on a finished read');

select is((select count(*)::int from public.library_entries where import_key in ('hardcover:721', 'hardcover:741', 'hardcover:742')), 0,
  'and a refused row writes nothing');

-- A row imported before adds nothing, progress included.
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:701", "book": {"title": "Open Page", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-01", "progress": {"page": 250}}
  ] $$)),
  array['imported'], 'the same row again is imported already');
select is(tests.place('hardcover:701'), 'page 120', 'and her progress is as the first import left it');

-- Only her own rows: another member's entries are not touched, whatever a key says.
select tests.act_as(:'noor_id');
select is(
  tests.outcomes(public.import_books($$ [
    {"key": "hardcover:701", "book": {"title": "Open Page", "authors": ["Ida Example"], "source": "manual"},
     "status": "reading", "started_on": "2026-09-01", "progress": {"percent": 5}}
  ] $$)),
  array['added'], 'another member imports the same key: her own entry');
select is(
  (select count(*)::int from public.reading_sessions where import_key = 'hardcover:701'), 1,
  'she sees only her own session (the other member''s is hers alone)');

select * from finish();
rollback;
