-- Social v1, after gate 1's review (docs/proposals/social-v1-contract.md §1.5, "Hardening"):
--   supabase test db
--
-- A declined request does not survive a member going public (it would be the only "requested"
-- left on a public account, and so tell the asker he was declined). A Book hidden from followers
-- is hidden from her public reading page and its cards too. Her reading record names a Book by
-- the columns the app reads and nothing else. The private tables are behind RLS as well.

begin;
select plan(9);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-5', 'social hardening test', 10);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-5', 'name', p_name)), now(), now(), now());
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

create or replace function tests.snap(p_title text)
returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'), 'source', 'apple',
                            'apple_id', (9700000000 + floor(random() * 99999999))::bigint::text,
                            'cover_url', 'https://example.org/' || md5(p_title) || '.jpg')
$$;

create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer as $$ select book_id from public.library_entries where id = p_entry $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;
create temporary table links (name text primary key, link text) on commit drop;
grant all on links to authenticated, anon;

insert into ids values
  ('ada', tests.member('ada@social5.pgtap.test', 'Ada')),
  ('ben', tests.member('ben@social5.pgtap.test', 'Ben'));

update private.social_config set settle_window = interval '0';

-- ------------------------------------------------- a decline, then going public

select tests.act_as((select id from ids where name = 'ada'));
insert into links values ('ada', (select public.my_social() ->> 'link'));
select tests.act_as((select id from ids where name = 'ben'));
select public.follow_target((select link from links where name = 'ada'));
select public.follow((select id from ids where name = 'ada'));
select tests.act_as((select id from ids where name = 'ada'));
select public.answer_request((select id from ids where name = 'ben'), false);
select public.set_private(false);

select tests.act_as((select id from ids where name = 'ben'));
select is(public.follow_target((select link from links where name = 'ada')) ->> 'state', 'none',
  'once she is public, her card offers him Follow, not a request she declined');
select is(public.member_profile((select id from ids where name = 'ada')) ->> 'state', 'none',
  'and so does her profile');
select ok(not ((public.my_people() -> 'requested') @> jsonb_build_array(jsonb_build_object('id', (select id from ids where name = 'ada')))),
  'and his own list no longer holds the request');

-- ------------------------------------------------ hidden from the reading page too

select tests.act_as((select id from ids where name = 'ada'));
insert into ids values ('kept', (public.add_to_library(tests.snap('Kept Book'), 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'kept'), current_date, 18, null);
insert into ids values ('hush', (public.add_to_library(tests.snap('Hush Book'), 'reading', current_date - 3)).id);
select public.finish_reading((select id from ids where name = 'hush'), current_date, 18, 'Mine alone.');
select public.set_reading_page(true);
select public.share_book_card(tests.book_of((select id from ids where name = 'hush')), true);
insert into links values ('page', (select token from public.reading_pages where member_id = (select id from ids where name = 'ada')));
select public.set_entry_hidden((select id from ids where name = 'hush'), true);

select tests.act_anon();
select ok(position('Kept Book' in public.public_reading_page((select link from links where name = 'page'))::text) > 0,
  'her reading page still shows what she did not hide');
select ok(position('Hush Book' in public.public_reading_page((select link from links where name = 'page'))::text) = 0,
  'but not a Book she hid from followers');
select is(public.public_book_card((select link from links where name = 'page'), tests.book_of((select id from ids where name = 'hush'))), null::jsonb,
  'and its card, shared before, is gone');

-- -------------------------------------------------------------- the record's Book

select tests.act_as((select id from ids where name = 'ben'));
select is(
  (select array_agg(k order by k) from jsonb_object_keys(
     public.member_reading_record((select id from ids where name = 'ada')) -> 'reads' -> 0 -> 'entry' -> 'book') k),
  array['apple_id', 'authors', 'cover_dominant', 'cover_secondary', 'cover_thumbhash', 'cover_url', 'created_at',
        'description', 'format', 'goodreads', 'id', 'isbn10', 'isbn13', 'language', 'openlibrary_edition_key',
        'openlibrary_work_key', 'page_count', 'published_year', 'publisher', 'source', 'title'],
  'her record names a Book by the columns the app reads, and nothing else');

-- ------------------------------------------------------------ the private tables

reset role;
select ok((select relrowsecurity from pg_class where oid = 'private.social_config'::regclass), 'social_config is behind RLS');
select ok((select relrowsecurity from pg_class where oid = 'private.follow_calls'::regclass), 'follow_calls is behind RLS');

select * from finish();
rollback;
