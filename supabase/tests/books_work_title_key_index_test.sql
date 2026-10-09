-- The index behind import_books' title match (perf assessment F2):
--   supabase test db
--
-- books_work_title_key indexes work_title_key(title); it changes the plan of the
-- "hers under another edition" lookup and nothing else. The same file imported by
-- two members, one without the index (dropped here, inside the transaction) and
-- one with it, gives the same outcome for every row and the same entries.

begin;
select plan(5);

select has_index('public', 'books', 'books_work_title_key', 'books has the work title index');
select ok(pg_get_indexdef('public.books_work_title_key'::regclass) like '%work_title_key(title)%',
          'on work_title_key(title)');

insert into public.invite_codes (code, label, max_uses) values ('T-TITLE-IDX', 'title index test', 5);

create schema if not exists tests;

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-TITLE-IDX"}'::jsonb, now(), now(), now());
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

create or replace function tests.plan_lines(p_sql text)
returns setof text language plpgsql as $$
declare v_line text;
begin
  for v_line in execute 'explain ' || p_sql loop
    return next v_line;
  end loop;
end;
$$;

-- The shelf, then the file again from another export: other keys, other editions
-- of the same works (series brackets, an edition note, a colon subtitle, an accent,
-- an ampersand), a row whose title matches but whose author does not, and new books.
-- Answers every outcome by key, and what her Library holds afterwards.
create or replace function tests.fixture()
returns text language plpgsql as $$
declare
  v_first jsonb;
  v_second jsonb;
  v_entries text;
begin
  v_first := public.import_books($f$ [
    {"key": "goodreads:1", "file_title": "Red Rising", "file_author": "Pierce Brown",
     "book": {"title": "Red Rising (Red Rising Saga, #1)", "authors": ["Pierce Brown"], "source": "manual"}, "status": "finished",
     "started_on": "2024-01-01", "ended_on": "2024-01-20"},
    {"key": "goodreads:2", "file_title": "Dune: Part One", "file_author": "Frank Herbert",
     "book": {"title": "Dune: Part One", "authors": ["Frank Herbert"], "source": "manual"}, "status": "reading", "started_on": "2025-02-01"},
    {"key": "goodreads:3", "file_title": "Café Noir", "file_author": "Ida Example",
     "book": {"title": "Café Noir", "authors": ["Ida Example"], "source": "manual"}, "status": "want_to_read"},
    {"key": "goodreads:4", "file_title": "Salt & Iron", "file_author": "Nora Vale",
     "book": {"title": "Salt & Iron", "authors": ["Nora Vale"], "source": "manual"}, "status": "finished",
     "started_on": "2023-05-01", "ended_on": "2023-05-10"}
  ] $f$);
  v_second := public.import_books($f$ [
    {"key": "hardcover:1", "file_title": "Red Rising", "file_author": "Pierce Brown",
     "book": {"title": "Red Rising [Anniversary Edition]", "authors": ["Pierce Brown"], "source": "manual"}, "status": "finished",
     "started_on": "2024-01-01", "ended_on": "2024-01-20"},
    {"key": "hardcover:2", "file_title": "Dune", "file_author": "Frank Herbert",
     "book": {"title": "Dune", "authors": ["Frank Herbert"], "source": "manual"}, "status": "reading", "started_on": "2025-02-01"},
    {"key": "hardcover:3", "file_title": "Cafe Noir", "file_author": "Ida Example",
     "book": {"title": "Cafe Noir", "authors": ["Ida Example"], "source": "manual"}, "status": "want_to_read"},
    {"key": "hardcover:4", "file_title": "Salt and Iron", "file_author": "Nora Vale",
     "book": {"title": "Salt and Iron", "authors": ["Nora Vale"], "source": "manual"}, "status": "want_to_read"},
    {"key": "hardcover:5", "file_title": "Red Rising", "file_author": "Someone Else",
     "book": {"title": "Red Rising", "authors": ["Someone Else"], "source": "manual"}, "status": "want_to_read"},
    {"key": "hardcover:6", "file_title": "A New Book", "file_author": "Ida Example",
     "book": {"title": "A New Book", "authors": ["Ida Example"], "source": "manual"}, "status": "want_to_read"}
  ] $f$);
  select string_agg(b.title || '/' || e.status, ', ' order by b.title, e.status)
    into v_entries
    from public.library_entries e join public.books b on b.id = e.book_id
   where e.member_id = auth.uid();
  return (select string_agg(coalesce(r->>'error', r->>'outcome'), ',' order by r->>'key')
            from jsonb_array_elements(v_first || v_second) r)
         || ' | ' || v_entries;
end;
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.member('before@title-index.test') as before_id \gset
select tests.member('after@title-index.test') as after_id \gset

-- Without the index: how the lookup worked until now.
drop index public.books_work_title_key;
select tests.act_as(:'before_id');
select tests.fixture() as without_index \gset
reset role;

create index books_work_title_key on public.books (public.work_title_key(title));
select tests.act_as(:'after_id');
select tests.fixture() as with_index \gset
reset role;

select ok(:'without_index'::text like '%in_library%' and :'without_index'::text like '%added%',
          'the fixture both matches by title and adds: ' || :'without_index'::text);
select is(:'with_index'::text, :'without_index'::text, 'the same outcomes and entries with and without the index');

-- The planner can use it (few rows here, so ask it not to scan).
set local enable_seqscan = off;
select ok((select string_agg(l, E'\n') from tests.plan_lines($q$ select 1 from public.books where public.work_title_key(title) = 'red rising' $q$) l) like '%books_work_title_key%',
          'a lookup by work_title_key(title) can use the index');

select * from finish();
rollback;
