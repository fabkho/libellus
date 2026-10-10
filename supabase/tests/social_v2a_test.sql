-- Social v2a, database (docs/proposals/social-v2a-contract.md §1):
--   supabase test db
--
-- Four members as in v1 (Ida private, Pia public, Ben her follower, Sam a stranger) and Dan, who
-- follows Ida and is blocked by her. Spoilers: a flagged review is sent but folded for anyone who has
-- not finished the same Book (same Book: the same row or the same work key), never for the author,
-- always for a visitor with no sign-in; a switch that hides the review hides the flag. Likes: who may
-- like, what is counted, who sees the likers, what goes with a follow, a block and a hidden Book, the
-- hourly limit. both_read, circle_reading and circle_want: the switches, hidden Books, blocks, a
-- request that waits, and the same Book under another edition. Assertions ask about rows this test made.

begin;
select plan(152);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-SOCIAL-V2A', 'social v2a test', 30);

create or replace function tests.member(p_email text, p_name text default null)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_strip_nulls(jsonb_build_object('invite_code', 'T-SOCIAL-V2A', 'name', p_name)), now(), now(), now());
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

-- A Book snapshot; two editions of one work share the work key.
create or replace function tests.snap(p_title text, p_work text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('title', p_title, 'authors', jsonb_build_array('An Author'),
         'source', 'apple', 'apple_id', (9700000000 + floor(random() * 99999999))::bigint::text,
         'openlibrary_work_key', p_work))
$$;
create or replace function tests.reading(p_title text, p_work text default null)
returns uuid language sql as $$
  select (public.add_to_library(tests.snap(p_title, p_work), 'reading', current_date - 3)).id
$$;
create or replace function tests.wanting(p_title text, p_work text default null)
returns uuid language sql as $$
  select (public.add_to_library(tests.snap(p_title, p_work), 'want_to_read')).id
$$;
-- A finished read: the Rating in quarters, the review (and its flag) if given.
create or replace function tests.finished(p_title text, p_work text, p_rating integer, p_review text, p_spoilers boolean default false, p_ended date default current_date)
returns uuid language plpgsql as $$
declare v_entry uuid;
begin
  v_entry := (public.add_to_library(tests.snap(p_title, p_work), 'reading', p_ended - 4)).id;
  if p_spoilers then
    perform public.finish_reading(v_entry, p_ended, p_rating, p_review, true);
  else
    perform public.finish_reading(v_entry, p_ended, p_rating, p_review);
  end if;
  return v_entry;
end;
$$;
create or replace function tests.session_of(p_entry uuid)
returns uuid language sql security definer set search_path = pg_catalog, public as $$
  select id from public.reading_sessions where entry_id = p_entry and outcome = 'finished'
   order by ended_on desc nulls last, created_at desc limit 1
$$;
create or replace function tests.open_session_of(p_entry uuid)
returns uuid language sql security definer set search_path = pg_catalog, public as $$
  select id from public.reading_sessions where entry_id = p_entry and outcome is null
$$;
create or replace function tests.book_of(p_entry uuid)
returns uuid language sql security definer set search_path = pg_catalog, public as $$
  select book_id from public.library_entries where id = p_entry
$$;
create or replace function tests.has_book(p_list jsonb, p_title text, p_kind text default null)
returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(coalesce(p_list, '[]')) e
                  where e -> 'book' ->> 'title' = p_title and (p_kind is null or e ->> 'kind' = p_kind))
$$;
create or replace function tests.entry_of(p_list jsonb, p_title text, p_kind text default null)
returns jsonb language sql as $$
  select e from jsonb_array_elements(coalesce(p_list, '[]')) e
   where e -> 'book' ->> 'title' = p_title and (p_kind is null or e ->> 'kind' = p_kind) limit 1
$$;
-- A member's finished row on her profile.
create or replace function tests.row_of(p_profile jsonb, p_title text)
returns jsonb language sql as $$
  select e from jsonb_array_elements(coalesce(p_profile -> 'finished', '[]')) e
   where e -> 'book' ->> 'title' = p_title limit 1
$$;
-- A finished row of a reading page.
create or replace function tests.page_row(p_page jsonb, p_title text)
returns jsonb language sql as $$
  select e from jsonb_array_elements(coalesce(p_page -> 'finished', '[]')) e
   where e -> 'book' ->> 'title' = p_title limit 1
$$;
-- The member ids of the answer's row for a Book, sorted.
create or replace function tests.circle_ids(p_res jsonb, p_book uuid)
returns text[] language sql as $$
  select coalesce((select array_agg(m ->> 'id' order by m ->> 'id')
                     from jsonb_array_elements(coalesce(
                       (select r -> 'members' from jsonb_array_elements(coalesce(p_res, '[]')) r
                         where r ->> 'book' = p_book::text), '[]')) m), '{}')
$$;
create or replace function tests.circle_more(p_res jsonb, p_book uuid)
returns integer language sql as $$
  select (r ->> 'more')::integer from jsonb_array_elements(coalesce(p_res, '[]')) r where r ->> 'book' = p_book::text
$$;
create or replace function tests.likes_of(p_session uuid)
returns bigint language sql security definer set search_path = pg_catalog, public as $$
  select count(*) from public.likes where session_id = p_session
$$;
create or replace function tests.ids_sorted(variadic p_ids uuid[])
returns text[] language sql as $$ select array_agg(i::text order by i::text) from unnest(p_ids) i $$;

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

create temporary table ids (name text primary key, id uuid) on commit drop;
grant all on ids to authenticated, anon;
create temporary table tokens (name text primary key, token text) on commit drop;
grant all on tokens to authenticated, anon;

insert into ids values
  ('ida', tests.member('ida@v2a.pgtap.test', 'Ida')),
  ('pia', tests.member('pia@v2a.pgtap.test', 'Pia')),
  ('ben', tests.member('ben@v2a.pgtap.test', 'Ben')),
  ('cy',  tests.member('cy@v2a.pgtap.test', 'Cy')),
  ('sam', tests.member('sam@v2a.pgtap.test', 'Sam')),
  ('dan', tests.member('dan@v2a.pgtap.test', 'Dan')),
  ('uf',  tests.member('uf@v2a.pgtap.test', 'Uf')),
  ('rf',  tests.member('rf@v2a.pgtap.test', 'Rf')),
  ('e1',  tests.member('e1@v2a.pgtap.test', 'E1')),
  ('e2',  tests.member('e2@v2a.pgtap.test', 'E2')),
  ('e3',  tests.member('e3@v2a.pgtap.test', 'E3'));

update private.social_config set settle_window = interval '0';

-- Ida (private): a spoiler review, a plain one, a Book she will hide, three more finished reads (one
-- of them in 2020), her Dune and Solaris, and Emma to read.
select tests.act_as((select id from ids where name = 'ida'));
insert into ids values
  ('pir',  tests.finished('Piranesi', 'OLPIR', 18, 'The twist is the house.', true)),
  ('cir',  tests.finished('Circe', 'OLCIR', 16, 'Lovely.', false, current_date - 1)),
  ('sec',  tests.finished('Secret Book', 'OLSEC', 12, null, false, current_date - 2)),
  ('f1',   tests.finished('Old One', 'OLF1', 14, null, false, date '2020-05-05')),
  ('f2',   tests.finished('Fourth', 'OLF2', 10, null)),
  ('f3',   tests.finished('Fifth', 'OLF3', 10, null)),
  ('f4',   tests.finished('Sixth', 'OLF4', 10, null)),
  ('dune', tests.reading('Dune', 'OLDUNE')),
  ('sol',  tests.reading('Solaris', 'OLSOL')),
  ('emma', tests.wanting('Emma', 'OLEMMA'));

-- Pia (public): a spoiler review.
select tests.act_as((select id from ids where name = 'pia'));
select public.set_private(false);
insert into ids values ('ham', tests.finished('Hamnet', 'OLHAM', 18, 'Everyone knows how it ends.', true));

-- Ben: Circe in another edition (older, 3 stars), Dune, Solaris, Emma, Old One, Ben's own Book.
select tests.act_as((select id from ids where name = 'ben'));
insert into ids values
  ('b_cir',  tests.finished('Circe (Ben''s)', 'OLCIR', 12, null, false, current_date - 40)),
  ('b_f1',   tests.finished('Old One (Ben''s)', 'OLF1', 20, null, false, date '2020-06-01')),
  ('b_sec',  tests.finished('Secret Book (Ben''s)', 'OLSEC', 8, null)),
  ('b_dune', tests.reading('Dune (Ben''s)', 'OLDUNE')),
  ('b_sol',  tests.reading('Solaris (Ben''s)', 'OLSOL')),
  ('b_emma', tests.wanting('Emma (Ben''s)', 'OLEMMA')),
  ('b_sam',  tests.finished('Sam Wrote This (Ben''s)', 'OLSAM', 8, null)),
  ('b_own',  tests.finished('Ben Wrote This', 'OLBEN', 14, 'Mine.'));

-- Cy: Piranesi (another edition), Dune, Solaris, Emma.
select tests.act_as((select id from ids where name = 'cy'));
insert into ids values
  ('c_pir',  tests.finished('Piranesi (Cy''s)', 'OLPIR', 16, null)),
  ('c_dune', tests.reading('Dune (Cy''s)', 'OLDUNE')),
  ('c_sol',  tests.reading('Solaris (Cy''s)', 'OLSOL')),
  ('c_emma', tests.wanting('Emma (Cy''s)', 'OLEMMA'));

-- The rest read Dune (E1 to E3), Solaris and Emma (Sam, who only waits, and Dan, whom Ben does not follow).
select tests.act_as((select id from ids where name = 'e1'));
select tests.reading('Dune (E1)', 'OLDUNE'), tests.wanting('Emma (E1)', 'OLEMMA');
select tests.act_as((select id from ids where name = 'e2'));
select tests.reading('Dune (E2)', 'OLDUNE');
select tests.act_as((select id from ids where name = 'e3'));
select tests.reading('Dune (E3)', 'OLDUNE');
select tests.act_as((select id from ids where name = 'sam'));
select tests.reading('Solaris (Sam)', 'OLSOL'), tests.wanting('Emma (Sam)', 'OLEMMA'), tests.finished('Sam Wrote This', 'OLSAM', 14, 'Sam''s.'), tests.finished('Circe (Sam''s)', 'OLCIR', 10, null);
select tests.act_as((select id from ids where name = 'dan'));
select tests.reading('Solaris (Dan)', 'OLSOL'), tests.finished('Circe (Dan''s)', 'OLCIR', 8, null);
select tests.act_as((select id from ids where name = 'uf'));
select tests.finished('Uf Wrote This', 'OLUF', 14, null);

-- Follows: Ben follows Ida, Pia, Cy and E1 to E3, and asked Sam; Cy, Dan, Uf and Rf follow Ida.
reset role;
insert into public.follows (follower_id, followee_id, accepted_at)
select (select id from ids where name = f), (select id from ids where name = t), case when t = 'sam' then null else now() end
  from (values ('ben','ida'), ('ben','pia'), ('ben','cy'), ('ben','e1'), ('ben','e2'), ('ben','e3'), ('ben','sam'),
               ('cy','ida'), ('dan','ida'), ('uf','ida'), ('rf','ida')) as x(f, t);

-- ------------------------------------------------------------ 1.1 spoiler-safe reviews

select tests.act_as((select id from ids where name = 'ben'));
create temporary table feed_ben as select public.feed() as f;
grant all on feed_ben to authenticated;
select is(tests.entry_of((select f from feed_ben), 'Piranesi', 'finished') ->> 'review', 'The twist is the house.',
          'a flagged review is still sent …');
select is(tests.entry_of((select f from feed_ben), 'Piranesi', 'finished') -> 'spoilers', 'true'::jsonb, '… says it has spoilers …');
select is(tests.entry_of((select f from feed_ben), 'Piranesi', 'finished') -> 'folded', 'true'::jsonb,
          '… and is folded for a reader who has not finished the Book');
select is(tests.entry_of((select f from feed_ben), 'Circe', 'finished') -> 'spoilers', 'false'::jsonb, 'an unflagged review (an old call) has no spoilers');
select is(tests.entry_of((select f from feed_ben), 'Circe', 'finished') -> 'folded', 'false'::jsonb, 'and is never folded');
select is(tests.entry_of((select f from feed_ben), 'Piranesi', 'finished') ->> 'sessionId', (select tests.session_of((select id from ids where name = 'pir')))::text,
          'the feed names the read (the id a like needs)');
select is(tests.entry_of((select f from feed_ben), 'Dune', 'started') -> 'sessionId', 'null'::jsonb, 'a started row names no finished read');
select is(tests.entry_of((select f from feed_ben), 'Dune', 'started') -> 'likes', '0'::jsonb, 'and has no likes');

select tests.act_as((select id from ids where name = 'cy'));
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'folded', 'false'::jsonb,
          'a reader who finished the same Book (another edition, the same work) sees it unfolded');
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'spoilers', 'true'::jsonb, 'though it still says spoilers');

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') -> 'folded', 'true'::jsonb,
          'a member''s finished row folds as the feed does');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') ->> 'review', 'The twist is the house.',
          'with the review sent');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Circe') -> 'folded', 'false'::jsonb, 'an unflagged row is not folded');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') ->> 'sessionId',
          (select tests.session_of((select id from ids where name = 'pir')))::text, 'and names the read');
select tests.act_as((select id from ids where name = 'cy'));
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') -> 'folded', 'false'::jsonb,
          'a reader of the same Book sees her row unfolded');
select tests.act_as((select id from ids where name = 'sam'));
select is(tests.row_of(public.member_profile((select id from ids where name = 'pia')), 'Hamnet') -> 'folded', 'true'::jsonb,
          'a stranger''s view of a public account folds too');

-- The author is never folded, a visitor with no sign-in always is.
select tests.act_as((select id from ids where name = 'ida'));
insert into tokens select 'ida', token from public.set_reading_page(true);
select public.set_reading_page_sections('{"finished": true}');
select public.share_book_card(tests.book_of((select id from ids where name = 'pir')), true);
select tests.act_anon();
select is(tests.page_row(public.public_reading_page((select token from tokens where name = 'ida')), 'Piranesi') -> 'folded', 'true'::jsonb,
          'a visitor with no sign-in gets a spoiler review folded on the reading page');
select is(tests.page_row(public.public_reading_page((select token from tokens where name = 'ida')), 'Piranesi') -> 'spoilers', 'true'::jsonb, 'and told');
select is(public.public_book_card((select token from tokens where name = 'ida'), tests.book_of((select id from ids where name = 'pir'))) -> 'folded',
          'true'::jsonb, 'and on the Book''s card');
select ok(public.public_book_card((select token from tokens where name = 'ida'), tests.book_of((select id from ids where name = 'pir'))) ->> 'review' is not null,
          'the card still sends the review it is shared with');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.public_book_card((select token from tokens where name = 'ida'), tests.book_of((select id from ids where name = 'pir'))) -> 'folded',
          'true'::jsonb, 'a signed-in member who has not finished it: folded');
select tests.act_as((select id from ids where name = 'cy'));
select is(public.public_book_card((select token from tokens where name = 'ida'), tests.book_of((select id from ids where name = 'pir'))) -> 'folded',
          'false'::jsonb, 'one who has: not folded');
select tests.act_as((select id from ids where name = 'ida'));
select is(tests.page_row(public.public_reading_page((select token from tokens where name = 'ida')), 'Piranesi') -> 'folded', 'false'::jsonb,
          'the author reads her own page unfolded');
select is(tests.page_row(public.public_reading_page((select token from tokens where name = 'ida')), 'Piranesi') -> 'spoilers', 'true'::jsonb, 'with the flag');

-- A switch that hides the review hides the flag with it.
select public.set_social_sections('{"reviews": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'review', 'null'::jsonb, 'Reviews off: no review in the feed …');
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'spoilers', 'false'::jsonb, '… and no flag, it would tell there is one');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') -> 'spoilers', 'false'::jsonb, 'nor on the profile');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') -> 'folded', 'false'::jsonb, 'nor a fold');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"reviews": true}');

-- The writers: the flag goes where the review goes.
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'pir'))), true,
          'finish_reading wrote the flag');
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'cir'))), false,
          'the old call wrote none');
select is((select review_spoilers from public.update_session(tests.session_of((select id from ids where name = 'cir')),
            current_date - 5, current_date - 1, 16, 'Lovely.', null, true)), true, 'update_session sets it');
select is((select review_spoilers from public.update_session(tests.session_of((select id from ids where name = 'cir')),
            current_date - 5, current_date - 1, 16, 'Lovely.')), false, 'an edit without it clears it (the whole state)');
select is((select review_spoilers from public.update_session(tests.session_of((select id from ids where name = 'cir')),
            current_date - 5, current_date - 1, 16, null, null, true)), false, 'and a blank review has no flag');
insert into ids values ('added', (public.add_to_library(tests.snap('Added Finished'), 'finished', current_date - 3, current_date - 2, 12, 'Plot!', true)).id);
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'added'))),
          true, 'add_to_library with a finished status takes it');
insert into ids values ('sw', tests.reading('Synced Write'));
select public.sync_write(gen_random_uuid(), 'finish_reading', jsonb_build_object(
  'p_entry_id', (select id from ids where name = 'sw'), 'p_ended_on', current_date, 'p_rating', 12, 'p_review', 'Queued.', 'p_review_spoilers', true));
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'sw'))), true,
          'sync_write finish_reading carries it');
select public.sync_write(gen_random_uuid(), 'update_session', jsonb_build_object(
  'p_session_id', tests.session_of((select id from ids where name = 'sw')), 'p_started_on', current_date - 3, 'p_ended_on', current_date,
  'p_rating', 12, 'p_review', 'Queued again.'));
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'sw'))), false,
          'and a write queued before the release (no key) applies with false');
select public.sync_write(gen_random_uuid(), 'update_session', jsonb_build_object(
  'p_session_id', tests.session_of((select id from ids where name = 'sw')), 'p_started_on', current_date - 3, 'p_ended_on', current_date,
  'p_rating', 12, 'p_review', 'Queued again.', 'p_review_spoilers', true));
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'sw'))), true,
          'sync_write update_session carries it');
insert into ids values ('queued', (public.sync_write(gen_random_uuid(), 'add_to_library', jsonb_build_object(
  'p_book', tests.snap('Queued Add'), 'p_status', 'finished', 'p_started_on', current_date - 3, 'p_ended_on', current_date - 1,
  'p_review', 'Spoilers inside', 'p_review_spoilers', true)) ->> 'entry_id')::uuid);
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'queued'))), true,
          'and sync_write add_to_library');
insert into ids values ('manual', (public.add_manual_book('Manual Spoiler', array['Me'], null, 100, 'finished', current_date - 3, current_date - 1, 10, 'Big reveal', true)).id);
select is((select review_spoilers from public.reading_sessions where id = tests.session_of((select id from ids where name = 'manual'))), true,
          'and add_manual_book');
select is(has_function_privilege('anon', 'public.finish_reading(uuid, date, integer, text, boolean)', 'execute'), false, 'the new finish_reading is closed to anon');
select is(has_function_privilege('authenticated', 'public.add_to_library(jsonb, public.entry_status, date, date, integer, text, boolean)', 'execute'), true,
          'and open to members, add_to_library too');

-- ---------------------------------------------------------------------- 1.2 likes

select tests.act_as((select id from ids where name = 'ben'));
select is(public."like"(tests.session_of((select id from ids where name = 'pir'))), '{"likes": 1, "liked": true}'::jsonb, 'a follower likes a finished read');
select is(public."like"(tests.session_of((select id from ids where name = 'pir'))) -> 'likes', '1'::jsonb, 'again: nothing more (idempotent)');
select is(tests.likes_of(tests.session_of((select id from ids where name = 'pir'))), 1::bigint, 'one row');
select throws_ok(format($$select public."like"(%L)$$, tests.open_session_of((select id from ids where name = 'sol'))), 'PT404', 'not_found',
                 'a read that is not finished is not found');
select throws_ok(format($$select public."like"(%L)$$, gen_random_uuid()), 'PT404', 'not_found', 'an unknown read is not found');
select tests.act_as((select id from ids where name = 'sam'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'pir'))), 'PT404', 'not_found',
                 'a stranger to a private account is not found');
select tests.act_as((select id from ids where name = 'ida'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'pir'))), 'PT404', 'not_found',
                 'her own read is not found');
select tests.act_as((select id from ids where name = 'cy'));
select is(public."like"(tests.session_of((select id from ids where name = 'pir'))) -> 'likes', '2'::jsonb, 'a second follower: two');
select is(public."like"(tests.session_of((select id from ids where name = 'cir'))) -> 'likes', '1'::jsonb, 'another read');
select tests.act_as((select id from ids where name = 'sam'));
select is(public."like"(tests.session_of((select id from ids where name = 'ham'))), '{"likes": 1, "liked": true}'::jsonb,
          'anyone may like a public account''s read');
select tests.act_as((select id from ids where name = 'pia'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'ham'))), 'PT404', 'not_found',
                 'but not their own');
select tests.act_as((select id from ids where name = 'dan'));
select is(public."like"(tests.session_of((select id from ids where name = 'pir'))) -> 'likes', '3'::jsonb, 'Dan follows Ida: three, for now');

-- The count and the flag in the answers.
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'likes', '3'::jsonb, 'the feed counts the likes');
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'liked', 'true'::jsonb, 'and says she liked it');
select is(tests.entry_of(public.feed(), 'Circe', 'finished') -> 'liked', 'false'::jsonb, 'another read of hers she did not: false');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Piranesi') -> 'likes', '3'::jsonb, 'the profile counts too');
select is(tests.row_of(public.member_profile((select id from ids where name = 'ida')), 'Circe') -> 'liked', 'false'::jsonb, 'and says who liked');

-- Who sees the likers: the author, newest first.
reset role;
update public.likes set created_at = now() - interval '2 hours'
 where member_id = (select id from ids where name = 'ben') and session_id = tests.session_of((select id from ids where name = 'pir'));
update public.likes set created_at = now() - interval '1 hour'
 where member_id = (select id from ids where name = 'cy') and session_id = tests.session_of((select id from ids where name = 'pir'));
update public.likes set created_at = now() - interval '3 hours'
 where member_id = (select id from ids where name = 'dan') and session_id = tests.session_of((select id from ids where name = 'pir'));
select tests.act_as((select id from ids where name = 'ida'));
select is((select array_agg(c ->> 'name') from jsonb_array_elements(public.session_likers(tests.session_of((select id from ids where name = 'pir')))) c),
          array['Cy', 'Ben', 'Dan'], 'the author sees who liked, newest first (names as cards)');
select is((public.session_likers(tests.session_of((select id from ids where name = 'pir'))) -> 0) ? 'photo', true, 'as cards (id, name, photo)');
select ok(position('v2a.pgtap.test' in public.session_likers(tests.session_of((select id from ids where name = 'pir')))::text) = 0, 'never an address');
select tests.act_as((select id from ids where name = 'ben'));
select throws_ok(format($$select public.session_likers(%L)$$, tests.session_of((select id from ids where name = 'pir'))), 'PT404', 'not_found',
                 'nobody else sees them, not even one who liked');
select throws_ok(format($$select public.session_likers(%L)$$, gen_random_uuid()), 'PT404', 'not_found', 'an unknown read is not found');

-- A block takes the likes with it, both ways, and keeps the blocked out.
select tests.act_as((select id from ids where name = 'ida'));
select public.block((select id from ids where name = 'dan'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'pir'))), 2::bigint, 'Ida blocks Dan: his like is gone');
select tests.act_as((select id from ids where name = 'dan'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'pir'))), 'PT404', 'not_found', 'and he cannot like again');
reset role;
insert into public.blocks (blocker_id, blocked_id) values ((select id from ids where name = 'pia'), (select id from ids where name = 'sam'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'ham'))), 0::bigint,
          'Pia blocks Sam: a stranger''s like of a public account goes with the block');
select tests.act_as((select id from ids where name = 'sam'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'ham'))), 'PT404', 'not_found',
                 'and he cannot like her again');
reset role;
insert into public.likes (member_id, session_id) values ((select id from ids where name = 'sam'), tests.session_of((select id from ids where name = 'ham')));
delete from public.blocks where blocker_id = (select id from ids where name = 'pia');
insert into public.blocks (blocker_id, blocked_id) values ((select id from ids where name = 'sam'), (select id from ids where name = 'pia'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'ham'))), 0::bigint, 'a block the other way takes the like too');
delete from public.blocks where blocker_id in (select id from ids where name in ('sam', 'pia'));

-- An unfollow, a removed follower: the likes go, the others stay.
select tests.act_as((select id from ids where name = 'uf'));
select public."like"(tests.session_of((select id from ids where name = 'cir')));
select public."like"(tests.session_of((select id from ids where name = 'pir')));
select tests.act_as((select id from ids where name = 'rf'));
select public."like"(tests.session_of((select id from ids where name = 'cir')));
select tests.act_as((select id from ids where name = 'ben'));
select public."like"(tests.session_of((select id from ids where name = 'cir')));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'cir'))), 4::bigint, 'Circe: Cy, Uf, Rf and Ben');
select tests.act_as((select id from ids where name = 'uf'));
select public.unfollow((select id from ids where name = 'ida'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'cir'))), 3::bigint, 'a follower who unfollows takes her like of Circe back …');
select is(tests.likes_of(tests.session_of((select id from ids where name = 'pir'))), 2::bigint, '… and of Piranesi (Ben and Cy remain)');
select tests.act_as((select id from ids where name = 'ida'));
select public.remove_follower((select id from ids where name = 'rf'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'cir'))), 2::bigint, 'a removed follower''s like goes');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.entry_of(public.feed(), 'Circe', 'finished') -> 'likes', '2'::jsonb, 'the feed counts what is left');
select public."like"(tests.session_of((select id from ids where name = 'ham')));
select tests.act_as((select id from ids where name = 'sam'));
select public."like"(tests.session_of((select id from ids where name = 'ham')));
select tests.act_as((select id from ids where name = 'ben'));
select public.unfollow((select id from ids where name = 'pia'));
select is(tests.likes_of(tests.session_of((select id from ids where name = 'ham'))), 1::bigint,
          'a public account keeps a stranger''s like when a follower unfollows (hers goes)');
select public.follow((select id from ids where name = 'pia'));

-- Only what the database still allows is counted.
reset role;
select is(private.like_count(tests.session_of((select id from ids where name = 'pir'))), 2, 'Piranesi: two counted');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"finished": false}');
reset role;
select is(private.like_count(tests.session_of((select id from ids where name = 'pir'))), 0, 'Finished off: nothing counted');
select tests.act_as((select id from ids where name = 'ben'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'cir'))), 'PT404', 'not_found', 'and nobody may like');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"finished": true}');
reset role;
select is(private.like_count(tests.session_of((select id from ids where name = 'pir'))), 2, 'switched back on: the likes are back');
-- Going private again: a stranger no longer sees her, so his like is not counted.
update public.social_settings set private = true where member_id = (select id from ids where name = 'pia');
select is(private.like_count(tests.session_of((select id from ids where name = 'ham'))), 0, 'a public account that goes private: the stranger''s like is not counted');
update public.social_settings set private = false where member_id = (select id from ids where name = 'pia');
-- Going private takes back what strangers gave: a public account's strangers' likes go, her followers' stay.
select tests.act_as((select id from ids where name = 'ben'));
select public."like"(tests.session_of((select id from ids where name = 'ham')));
select tests.act_as((select id from ids where name = 'pia'));
select public.set_private(true);
select is(tests.likes_of(tests.session_of((select id from ids where name = 'ham'))), 1::bigint,
          'set_private(true): the stranger''s like is deleted, the follower''s stays');
select public.set_private(false);
select is(tests.likes_of(tests.session_of((select id from ids where name = 'ham'))), 1::bigint,
          'public again: the stranger''s like does not come back');
reset role;
select is((select array_agg(member_id) from public.likes where session_id = tests.session_of((select id from ids where name = 'ham'))),
          array[(select id from ids where name = 'ben')], 'only Ben''s');

-- A hidden Book: its likes stay but are not counted or listed.
select tests.act_as((select id from ids where name = 'ida'));
select public.set_entry_hidden((select id from ids where name = 'pir'), true);
reset role;
select is(private.like_count(tests.session_of((select id from ids where name = 'pir'))), 0, 'hidden Book: not counted');
select is(tests.likes_of(tests.session_of((select id from ids where name = 'pir'))), 2::bigint, 'but not deleted');
select tests.act_as((select id from ids where name = 'ida'));
select is(public.session_likers(tests.session_of((select id from ids where name = 'pir'))), '[]'::jsonb, 'not listed to her either');
select ok(not exists (select 1 from jsonb_array_elements(public.my_recent_likes()) r where r -> 'book' ->> 'title' = 'Piranesi'), 'nor in Your circle');
select tests.act_as((select id from ids where name = 'ben'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'pir'))), 'PT404', 'not_found', 'and not likeable');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_entry_hidden((select id from ids where name = 'pir'), false);
select is(jsonb_array_length(public.session_likers(tests.session_of((select id from ids where name = 'pir')))), 2, 'unhidden: the likers are back');

-- Home's Your circle.
select is((select jsonb_array_length(public.my_recent_likes())), 2, 'two of her reads were liked lately (Piranesi and Circe)');
select is(public.my_recent_likes() -> 0 ->> 'count', '2', 'the count');
select is(public.my_recent_likes() -> 0 -> 'book' ->> 'title', 'Circe', 'the read liked most lately first');
select is(public.my_recent_likes() -> 1 -> 'book' ->> 'title', 'Piranesi', 'then the other');
select is((select array_agg(c ->> 'name') from jsonb_array_elements(public.my_recent_likes() -> 1 -> 'likers') c), array['Cy', 'Ben'], 'with who liked, newest first');
select is(public.my_recent_likes() -> 1 ->> 'session', tests.session_of((select id from ids where name = 'pir'))::text, 'and the read');
select ok(public.my_recent_likes() -> 0 ? 'at', 'and when');
reset role;
update public.likes set created_at = now() - interval '8 days' where session_id = tests.session_of((select id from ids where name = 'pir'));
select tests.act_as((select id from ids where name = 'ida'));
select is((select jsonb_array_length(public.my_recent_likes())), 1, 'likes older than a week are not news');
reset role;
insert into public.likes (member_id, session_id)
select (select id from ids where name = 'ben'), tests.session_of(i.id) from ids i where i.name in ('sec', 'f1', 'f2', 'f3', 'f4');
select tests.act_as((select id from ids where name = 'ida'));
select is((select jsonb_array_length(public.my_recent_likes())), 5, 'at most five reads');
reset role;
delete from public.likes where member_id = (select id from ids where name = 'ben')
   and session_id in (select tests.session_of(i.id) from ids i where i.name in ('sec', 'f1', 'f2', 'f3', 'f4'));

-- Taking it back; the hourly limit.
select tests.act_as((select id from ids where name = 'cy'));
select is(public.unlike(tests.session_of((select id from ids where name = 'cir'))), '{"likes": 1, "liked": false}'::jsonb, 'unlike takes a like back');
select is(public.unlike(tests.session_of((select id from ids where name = 'cir'))) -> 'likes', '1'::jsonb, 'again: nothing changes');
select tests.act_as((select id from ids where name = 'sam'));
select throws_ok(format($$select public.unlike(%L)$$, tests.session_of((select id from ids where name = 'cir'))), 'PT404', 'not_found',
                 'a read she cannot see is not found, for unlike too');
reset role;
delete from private.like_calls where member_id = (select id from ids where name = 'cy');
insert into private.like_calls (member_id) select (select id from ids where name = 'cy') from generate_series(1, 300);
select tests.act_as((select id from ids where name = 'cy'));
select throws_ok(format($$select public."like"(%L)$$, tests.session_of((select id from ids where name = 'sec'))), 'PT429', 'rate_limited',
                 'the 301st new like of the hour is refused');
select is(public."like"(tests.session_of((select id from ids where name = 'pir'))) -> 'liked', 'true'::jsonb, 'a like she already gave is not new: it still answers');
reset role;
delete from private.like_calls where member_id = (select id from ids where name = 'cy');

-- Closed to anyone who is not signed in; the tables stay shut.
select tests.act_anon();
select throws_ok($$select public."like"(gen_random_uuid())$$, '42501', null, 'signed out, a like is refused');
select throws_ok($$select public.both_read(gen_random_uuid())$$, '42501', null, 'and so is both_read');
select throws_ok($$select public.circle_reading('{}')$$, '42501', null, 'and the circle');
reset role;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('like', 'unlike', 'session_likers', 'my_recent_likes', 'both_read', 'circle_reading', 'circle_want')
              and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))),
          0, 'the new functions are for members only');
select is(has_table_privilege('authenticated', 'public.likes', 'select') or has_table_privilege('anon', 'public.likes', 'select')
          or has_table_privilege('authenticated', 'public.likes', 'insert'), false, 'likes has no grants');
select ok((select relrowsecurity from pg_class where oid = 'public.likes'::regclass), 'likes has RLS on');

-- ------------------------------------------------------------------ 1.3 you both read

-- Ben finishes Piranesi too (another edition of the work): the fold lifts, and it is a book they share.
select tests.act_as((select id from ids where name = 'ben'));
insert into ids values ('b_pir', tests.finished('Piranesi (Ben''s)', 'OLPIR', 14, null));
select is(tests.entry_of(public.feed(), 'Piranesi', 'finished') -> 'folded', 'false'::jsonb, 'once Ben has finished the Book his fold lifts');
select is((select array_agg(r -> 'book' ->> 'title' order by ord)
             from jsonb_array_elements(public.both_read((select id from ids where name = 'ida'))) with ordinality t(r, ord)),
          array['Piranesi', 'Circe', 'Secret Book', 'Old One'],
          'the Books both finished (other editions of one work too), newest of hers first, her edition''s title');
select is((select array_agg(k order by k) from jsonb_object_keys(public.both_read((select id from ids where name = 'ida')) -> 0) k),
          array['book', 'hers', 'mine'], 'and nothing else: no totals');
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'hers' ->> 'rating', '16', 'her rating');
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'mine' ->> 'rating', '12', 'mine');
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'mine' ->> 'endedOn', (current_date - 40)::text, 'when I finished it');
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'hers' ->> 'endedOn', (current_date - 1)::text, 'and when she did');
select is((select array_agg(r -> 'book' ->> 'title') from jsonb_array_elements(public.both_read((select id from ids where name = 'ida'), 2020)) r),
          array['Old One'], 'p_year limits to her reads ended that year');
select is(public.both_read((select id from ids where name = 'ida'), 2021), '[]'::jsonb, 'and a year she read nothing shared in is empty');
select is(public.both_read((select id from ids where name = 'ben')), '[]'::jsonb, 'for herself: nothing');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"ratings": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'hers' -> 'rating', 'null'::jsonb, 'Ratings off: her rating is null …');
select is(public.both_read((select id from ids where name = 'ida')) -> 1 -> 'mine' ->> 'rating', '12', '… mine stays');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"ratings": true, "year": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.both_read((select id from ids where name = 'ida'), 2020), '[]'::jsonb, 'Year off: her year page has nothing');
select is(public.both_read((select id from ids where name = 'ida')), '[]'::jsonb,
          'and so has her profile (as member_reading_record: every shared Book would reach past the twelve she shows)');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"year": true, "finished": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.both_read((select id from ids where name = 'ida')), '[]'::jsonb, 'Finished off: nothing');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"finished": true}');
select public.set_entry_hidden((select id from ids where name = 'cir'), true);
select tests.act_as((select id from ids where name = 'ben'));
select is(jsonb_array_length(public.both_read((select id from ids where name = 'ida'))), 3, 'a hidden Book is left out');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_entry_hidden((select id from ids where name = 'cir'), false);
select tests.act_as((select id from ids where name = 'sam'));
select is(public.both_read((select id from ids where name = 'ida')), '[]'::jsonb, 'a stranger to a private account: nothing, though Sam finished Circe too');
select tests.act_as((select id from ids where name = 'dan'));
select is(public.both_read((select id from ids where name = 'ida')), '[]'::jsonb, 'blocked: nothing, though Dan finished Circe too');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.both_read((select id from ids where name = 'sam')), '[]'::jsonb, 'a request that still waits: nothing');
select is(public.both_read(gen_random_uuid()), '[]'::jsonb, 'an unknown member: nothing');

-- ------------------------------------------------------- 1.4 the same book now

select tests.act_as((select id from ids where name = 'ben'));
create temporary table sol as select tests.book_of((select id from ids where name = 'b_sol')) as book;
create temporary table dune as select tests.book_of((select id from ids where name = 'b_dune')) as book;
create temporary table emma as select tests.book_of((select id from ids where name = 'b_emma')) as book;
grant all on sol, dune, emma to authenticated;
select is(tests.circle_ids(public.circle_reading(array[(select book from sol)]), (select book from sol)),
          tests.ids_sorted((select id from ids where name = 'ida'), (select id from ids where name = 'cy')),
          'those she follows who read Solaris now (other editions of the work), and not Sam, who only asked, or Dan, whom she does not follow');
select is(tests.circle_more(public.circle_reading(array[(select book from sol)]), (select book from sol)), 0, 'nobody more');
select is(jsonb_array_length(public.circle_reading(array[(select book from dune), tests.book_of((select id from ids where name = 'b_cir'))])), 1,
          'a Book nobody reads now, or that she is not reading, is left out');
select is(jsonb_array_length(public.circle_reading(array[(select book from dune)]) -> 0 -> 'members'), 3, 'at most three members …');
select is(tests.circle_more(public.circle_reading(array[(select book from dune)]), (select book from dune)), 2, '… and how many more');
select is(public.circle_reading(array[(select book from dune)]) -> 0 -> 'members' -> 0 ? 'photo', true, 'as cards');
reset role;
update public.library_entries e set added_at = now() - make_interval(hours => x.h)
  from (values ('e3', 1), ('e2', 2), ('e1', 3), ('ida', 4), ('cy', 5)) x(n, h), public.books b
 where e.member_id = (select id from ids where name = x.n) and b.id = e.book_id and b.openlibrary_work_key = 'OLDUNE';
select tests.act_as((select id from ids where name = 'ben'));
select is((select array_agg(m ->> 'name') from jsonb_array_elements(public.circle_reading(array[(select book from dune)]) -> 0 -> 'members') m),
          array['E3', 'E2', 'E1'], 'the three shown are the newest entries first');
select is(public.circle_reading(array[tests.book_of((select id from ids where name = 'sol'))]), '[]'::jsonb, 'a Book that is not in her Library: nothing');
select is(public.circle_reading(array[(select book from emma)]), '[]'::jsonb, 'her Want to read is not Reading now');
select is(public.circle_reading('{}'), '[]'::jsonb, 'no Books: nothing');
select is(public.circle_reading(null), '[]'::jsonb, 'null: nothing');
select is(jsonb_array_length(public.circle_reading(array(select gen_random_uuid() from generate_series(1, 49)) || (select book from sol))), 1,
          'the 50th Book is looked at …');
select is(jsonb_array_length(public.circle_reading(array(select gen_random_uuid() from generate_series(1, 50)) || (select book from sol))), 0,
          '… the 51st is not');
-- The very same row, not only the same work.
select tests.act_as((select id from ids where name = 'e2'));
create temporary table same as select tests.snap('Same Row') as snap;
grant all on same to authenticated;
select public.add_to_library((select snap from same), 'reading', current_date - 2);
select tests.act_as((select id from ids where name = 'ben'));
insert into ids values ('b_same', (public.add_to_library((select snap from same), 'reading', current_date - 1)).id);
select is(tests.circle_ids(public.circle_reading(array[tests.book_of((select id from ids where name = 'b_same'))]), tests.book_of((select id from ids where name = 'b_same'))),
          tests.ids_sorted((select id from ids where name = 'e2')), 'the same Book row, with no work key');

select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"reading": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_reading(array[(select book from sol)]), (select book from sol)),
          tests.ids_sorted((select id from ids where name = 'cy')), 'Reading off: she is not among them');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"reading": true}');
select public.set_entry_hidden((select id from ids where name = 'sol'), true);
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_reading(array[(select book from sol)]), (select book from sol)),
          tests.ids_sorted((select id from ids where name = 'cy')), 'a hidden Book: not among them');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_entry_hidden((select id from ids where name = 'sol'), false);

select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_want(array[(select book from emma)]), (select book from emma)),
          tests.ids_sorted((select id from ids where name = 'ida'), (select id from ids where name = 'cy'), (select id from ids where name = 'e1')),
          'who she follows wants to read Emma too (not Sam, who only asked)');
select is(public.circle_want(array[(select book from dune)]), '[]'::jsonb, 'Reading is not Want to read');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"want": false}');
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_want(array[(select book from emma)]), (select book from emma)),
          tests.ids_sorted((select id from ids where name = 'cy'), (select id from ids where name = 'e1')), 'Want off: she is not among them');
select is(tests.circle_ids(public.circle_reading(array[(select book from sol)]), (select book from sol)),
          tests.ids_sorted((select id from ids where name = 'ida'), (select id from ids where name = 'cy')), 'the switches are separate: Reading is still on');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_social_sections('{"want": true}');
select public.set_entry_hidden((select id from ids where name = 'emma'), true);
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_want(array[(select book from emma)]), (select book from emma)),
          tests.ids_sorted((select id from ids where name = 'cy'), (select id from ids where name = 'e1')), 'a hidden Book: not among them');
select tests.act_as((select id from ids where name = 'ida'));
select public.set_entry_hidden((select id from ids where name = 'emma'), false);

-- A block, either way, takes a member out of both.
select tests.act_as((select id from ids where name = 'cy'));
select public.block((select id from ids where name = 'ben'));
select tests.act_as((select id from ids where name = 'ben'));
select is(tests.circle_ids(public.circle_reading(array[(select book from sol)]), (select book from sol)),
          tests.ids_sorted((select id from ids where name = 'ida')), 'Cy blocked Ben: gone from Reading now');
select is(tests.circle_ids(public.circle_want(array[(select book from emma)]), (select book from emma)),
          tests.ids_sorted((select id from ids where name = 'ida'), (select id from ids where name = 'e1')), 'and from Want too');
reset role;
-- A follow that is only a request, or a follow that is gone, is no sight either: even with the rows still in place.
update public.follows set accepted_at = null where follower_id = (select id from ids where name = 'ben') and followee_id = (select id from ids where name = 'ida');
select tests.act_as((select id from ids where name = 'ben'));
select is(public.circle_reading(array[(select book from sol)]), '[]'::jsonb, 'Ida''s follow turned back into a request: nobody left (Cy blocked, Ida waiting)');

select * from finish();
rollback;
