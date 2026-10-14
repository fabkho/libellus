-- One Book, one cover (docs/plans/covers-consistency.md; 20261029010000_work_card_opens_cover.sql):
--   supabase test db
--
-- A work's card shows the cover of what it opens, as its page shows it: her Book's, else the Catalogue's
-- Book of the edition it opens (none where that Book has none), else that edition's own, else the work's.

begin;
select plan(8);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-ONE-COVER', 'one cover test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, jsonb_build_object('invite_code', 'T-ONE-COVER'), now(), now(), now());
  return v_id;
end;
$$;

create or replace function tests.act_as(p_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;

create or replace function tests.cover(p_id int) returns text language sql immutable as $$
  select 'https://covers.openlibrary.org/b/id/' || p_id || '-L.jpg'
$$;

create or replace function tests.card_cover(p_title text, p_language text) returns text language sql security definer as $$
  select public.work_card((select id from public.works where title = p_title), p_language) ->> 'coverUrl'
$$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- Whatever else is in this database is checked already: the checks below see only this test's Books.
update public.books set checked_at = now() where owner_id is null and checked_at is null;

-- Works the way the enrich function stores them: the work's own cover (Open Library's default edition)
-- and the English edition the card opens, with its own cover. No German edition.
insert into public.works (openlibrary_key, title, first_year, kind, cover_url, editions, fetched_at) values
  ('OL9900001W', 'Pgtap Own Edition Cover', 2001, 'novel', tests.cover(9002),
   jsonb_build_object('en', jsonb_build_object('title', 'Pgtap Own Edition Cover', 'isbn13', '9780000090010',
     'openlibrary_edition_key', 'OL9900001M', 'cover_url', tests.cover(9001))), now()),
  ('OL9900002W', 'Pgtap Lent Cover', 2001, 'novel', tests.cover(9004),
   jsonb_build_object('en', jsonb_build_object('title', 'Pgtap Lent Cover', 'isbn13', '9780000090027',
     'openlibrary_edition_key', 'OL9900002M', 'cover_url', null)), now()),
  ('OL9900003W', 'Pgtap Catalogued', 2001, 'novel', tests.cover(9006),
   jsonb_build_object('en', jsonb_build_object('title', 'Pgtap Catalogued', 'isbn13', '9780000090034',
     'openlibrary_edition_key', 'OL9900003M', 'cover_url', tests.cover(9005))), now()),
  ('OL9900004W', 'Pgtap No Edition', 2001, 'novel', tests.cover(9007), '{}'::jsonb, now()),
  ('OL9900007W', 'Pgtap Bare Catalogued', 2001, 'novel', tests.cover(9008),
   jsonb_build_object('en', jsonb_build_object('title', 'Pgtap Bare Catalogued', 'isbn13', '9780000090041',
     'openlibrary_edition_key', 'OL9900007M', 'cover_url', tests.cover(9009))), now());

select tests.act_as(tests.member('ada@one-cover.pgtap.test'));

select is(tests.card_cover('Pgtap Own Edition Cover', 'de'), tests.cover(9001),
  'a German reader''s card opens the English edition and shows that edition''s cover, not the work''s');
select is(tests.card_cover('Pgtap Own Edition Cover', 'en'), tests.cover(9001), 'and so does an English reader''s');
select is(tests.card_cover('Pgtap Lent Cover', 'de'), tests.cover(9004),
  'an edition without a cover of its own: the work''s, lent (the page shows the row''s)');
select is(tests.card_cover('Pgtap No Edition', 'de'), tests.cover(9007), 'a work with no edition to open shows its own');

-- Another member put the edition into the Catalogue with another picture: the card shows the Catalogue's
-- Book, as the page will (it finds the Book by the ISBN the card opens).
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Catalogued', 'authors', jsonb_build_array('An Author'),
  'source', 'openlibrary', 'openlibrary_edition_key', 'OL9900003M', 'isbn13', '9780000090034',
  'cover_url', 'https://is1-ssl.mzstatic.com/image/thumb/Publication1/v4/aa/bb/cc/x/9780000090034.jpg/600x900bb.jpg'), 'want_to_read', null)).id
  \gset catalogued_
reset role;
select tests.act_as(tests.member('ben@one-cover.pgtap.test'));
select is(tests.card_cover('Pgtap Catalogued', 'de'),
  'https://is1-ssl.mzstatic.com/image/thumb/Publication1/v4/aa/bb/cc/x/9780000090034.jpg/600x900bb.jpg',
  'the Catalogue''s Book of the edition comes before the edition''s cover the work names');

-- The Catalogue's Book of the edition has no cover: its page shows the Placeholder, so the card does too.
reset role;
select tests.act_as((select member_id from public.library_entries where id = :'catalogued_id'));
select (public.add_to_library(jsonb_build_object('title', 'Pgtap Bare Catalogued', 'authors', jsonb_build_array('An Author'),
  'source', 'openlibrary', 'openlibrary_edition_key', 'OL9900007M', 'isbn13', '9780000090041'), 'want_to_read', null)).book_id as bare
  \gset
reset role;
select tests.act_as(tests.member('cleo@one-cover.pgtap.test'));
select is(tests.card_cover('Pgtap Bare Catalogued', 'de'), null,
  'a Catalogue Book without a cover: no cover on the card either, whatever the work names');

-- Her own Book of the work: its cover, whatever the work says.
reset role;
insert into public.book_works (book_id, work_id, matched_by)
  select e.book_id, w.id, 'title' from public.library_entries e, public.works w where e.id = :'catalogued_id' and w.title = 'Pgtap Own Edition Cover';
select tests.act_as((select member_id from public.library_entries where id = :'catalogued_id'));
select is(tests.card_cover('Pgtap Own Edition Cover', 'de'),
  'https://is1-ssl.mzstatic.com/image/thumb/Publication1/v4/aa/bb/cc/x/9780000090034.jpg/600x900bb.jpg',
  'her Book of the work: her Book''s cover');
reset role;
insert into public.book_works (book_id, work_id, matched_by)
  select :'bare', w.id, 'title' from public.works w where w.title = 'Pgtap Bare Catalogued';
select tests.act_as((select member_id from public.library_entries where id = :'catalogued_id'));
select is(tests.card_cover('Pgtap Bare Catalogued', 'de'), null, 'and her Book without a cover: none, as her Book''s page shows');

select * from finish();
rollback;
