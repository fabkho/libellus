-- A miss is not a failure (social v2a contract §5):
--   supabase test db
--
-- When no source knows a Book (an import-only ISBN) the check marks it checked and unknown, not failed: no
-- source text, its description null, its keys kept, and it is shown to others as stored, like a Manual book
-- (title and authors, a cover by the S1 allowlist, no description), in the feed, a profile, the search, the
-- reading page. Only a mismatch is failed, and a failed row is read through the table by its holders only.

begin;
select plan(16);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-UNKNOWN-1', 'catalogue test', 20);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-UNKNOWN-1', 'name', p_name)), now(), now(), now());
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

create or replace function tests.act_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  execute 'set local role anon';
end;
$$;

-- A snapshot the way a client sends one: a blurb of her own, and a cover on a host that is not a source's.
create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9800000000 + floor(random() * 99999999))::bigint::text,
                            'description', 'Blurb of ' || p_title,
                            'cover_url', 'https://example.org/' || md5(p_title) || '.jpg',
                            'cover_thumbhash', 'abc', 'cover_dominant', '#112233', 'cover_secondary', '#445566')
$$;

create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;

-- Whatever else is in this database is checked already: the claims below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

create or replace function tests.record_book(p_member uuid, p_title text)
returns jsonb language sql security definer as $$
  select r -> 'entry' -> 'book'
    from jsonb_array_elements(public.member_reading_record(p_member) -> 'reads') r
   where r -> 'entry' -> 'book' ->> 'title' = p_title
$$;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;
update private.social_config set settle_window = interval '0';

insert into ids values
  ('ada', tests.member('ada@unknown.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@unknown.pgtap.test', 'Ben'));

select tests.act_as((select id from ids where name = 'ada'));
select public.set_private(false);
select public.set_reading_page(true);
select tests.act_as((select id from ids where name = 'ben'));
select public.follow((select id from ids where name = 'ada'));

select tests.act_as((select id from ids where name = 'ada'));
insert into ids values
  ('imp',  (public.add_to_library(tests.snap('Im Haus der Feinde') || '{"source":"apple","isbn13":"9788000000017","cover_url":"https://covers.openlibrary.org/b/id/9-L.jpg"}', 'reading', current_date - 3)).id),
  ('mis',  (public.add_to_library(tests.snap('Mismatched Pair') || '{"isbn13":"9788000000024"}', 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'imp'), current_date, 18, null);
select public.finish_reading((select id from ids where name = 'mis'), current_date, 18, null);
insert into links values ('page', (select token from public.reading_pages where member_id = (select id from ids where name = 'ada')));
reset role;
insert into ids select 'b_' || name, tests.book_of(id) from ids where name in ('imp', 'mis');
update public.books set description = 'legacy blurb' where id = (select id from ids where name = 'b_imp');

select is(public.catalogue_check_miss((select id from ids where name = 'b_imp')), true, 'a miss answers true');
select is((select (checked_at is not null, check_failed, check_unknown, description, isbn13)::text from public.books where id = (select id from ids where name = 'b_imp')),
  '(t,f,t,,9788000000017)', 'the Book is checked and unknown, not failed, with no description and its key');
select is(public.catalogue_check_miss((select id from ids where name = 'b_imp')), false, 'a Book already checked is not written again');
select is(public.catalogue_check_mismatch((select id from ids where name = 'b_mis')), true, 'a mismatch is the failed one');
select is((select (check_failed, check_unknown, isbn13)::text from public.books where id = (select id from ids where name = 'b_mis')), '(t,f,)', 'failed, not unknown, keys cleared');
select throws_ok($$ update public.books set check_failed = true, check_unknown = true where id = (select id from ids where name = 'b_imp') $$,
  '23514', null, 'a Book is never both');
select is(private.book_shown((select b from public.books b where b.id = (select id from ids where name = 'b_imp'))), true, 'an unknown Book is shown');
select is(private.description_shown((select b from public.books b where b.id = (select id from ids where name = 'b_imp'))), false, 'though it has no source description to show');
select is(public.catalogue_check_status() ->> 'unknown', (select count(*)::text from public.books where check_unknown and owner_id is null), 'the status counts unknown Books');

-- ------------------------------------------------------------- as Ben, a follower

select tests.act_as((select id from ids where name = 'ben'));
select ok(exists (select 1 from jsonb_array_elements(public.feed()) e
                   where e -> 'book' ->> 'title' = 'Im Haus der Feinde' and e -> 'book' -> 'unverified' is null
                     and e -> 'book' ->> 'cover_url' = 'https://covers.openlibrary.org/b/id/9-L.jpg'),
  'the feed names an unknown Book, with its allowlisted cover, not unverified');
select ok(exists (select 1 from jsonb_array_elements(public.member_profile((select id from ids where name = 'ada')) -> 'finished') e
                   where e -> 'book' ->> 'title' = 'Im Haus der Feinde' and e -> 'book' -> 'unverified' is null),
  'so does her profile');
select is(tests.record_book((select id from ids where name = 'ada'), 'Im Haus der Feinde') -> 'description', 'null'::jsonb, 'her record gives its title and no description');
select is((select count(*)::int from public.search_books('Im Haus der Feinde')), 1, 'the search finds it');
select is((select count(*)::int from public.books where id = (select id from ids where name = 'b_imp')), 1, 'and the table shows the row');
select is((select count(*)::int from public.books where id = (select id from ids where name = 'b_mis')), 0, 'while the failed one is not in the table for him');
select tests.act_anon();
select ok(position('Im Haus der Feinde' in public.public_reading_page((select link from links where name = 'page'))::text) > 0
          and position('Mismatched Pair' in public.public_reading_page((select link from links where name = 'page'))::text) = 0,
  'the public reading page names the unknown Book and not the failed one');

select * from finish();
rollback;
