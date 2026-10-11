-- Read as on a library entry (issue #169):
--   supabase test db
--
-- library_entries.read_as is physical, ebook, audiobook or null (not said), set through
-- set_read_as: only on the member's own entry, taken back with null, refused for any other
-- word. It belongs to the entry, not to a read: Finish and Read again leave it. Change edition
-- presets it from the new edition's format when her word was set and the edition is read
-- another way (move_entry_to); an unset one follows the edition by itself.

begin;
select plan(27);

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-READAS', 'read as test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-READAS"}'::jsonb, now(), now(), now());
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

create or replace function tests.read_as_of(p_entry uuid)
returns text language sql security definer as $$
  select coalesce(read_as, 'unset') from public.library_entries where id = p_entry
$$;

select tests.member('ida@readas.test') as ida_id \gset
select tests.member('max@readas.test') as max_id \gset

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

select tests.act_as(:'ida_id');
select (public.add_to_library('{"title":"Hyperion","source":"apple","apple_id":"990000169001","page_count":482}')).id as hyperion \gset
select tests.act_as(:'max_id');
select (public.add_to_library('{"title":"Hyperion","source":"apple","apple_id":"990000169001","page_count":482}')).id as max_hyperion \gset
select tests.act_as(:'ida_id');

-- ---------------------------------------------------------------- the default

select is(tests.read_as_of(:'hyperion'), 'unset', 'a new entry has not said how it was read');

-- --------------------------------------------------------------------- setting

select is((select read_as from public.set_read_as(:'hyperion', 'audiobook')), 'audiobook', 'sets the way and returns the entry');
select is(tests.read_as_of(:'hyperion'), 'audiobook', 'and stores it');
select is((select read_as from public.set_read_as(:'hyperion', 'physical')), 'physical', 'changes it');
select is((select read_as from public.set_read_as(:'hyperion', 'ebook')), 'ebook', 'to each of the three');
select is((select read_as from public.set_read_as(:'hyperion', null)), null, 'null takes her word back');
select is(tests.read_as_of(:'hyperion'), 'unset', 'and it is unset again');

-- ----------------------------------------------------------------- the rules

select throws_ok(format($$ select public.set_read_as(%L, 'paper') $$, :'hyperion'),
  '22023', 'read_as_invalid', 'any other word is refused');
select throws_ok(format($$ select public.set_read_as(%L, 'EBOOK') $$, :'hyperion'),
  '22023', 'read_as_invalid', 'the words are exact');
select throws_ok(format($$ select public.set_read_as(%L, 'ebook') $$, :'max_hyperion'),
  'P0002', 'entry_not_found', 'another member''s entry is not hers to change');
select throws_ok($$ select public.set_read_as(gen_random_uuid(), 'ebook') $$,
  'P0002', 'entry_not_found', 'neither is one that does not exist');
select throws_ok(format($$ update public.library_entries set read_as = 'ebook' where id = %L $$, :'hyperion'),
  '42501', null, 'the column is written only through set_read_as');

-- ---------------------------------------------------------- it stays with the entry

select public.set_read_as(:'hyperion', 'audiobook');
select public.start_reading(:'hyperion', current_date - 3);
select public.finish_reading(:'hyperion', current_date, 16, 'long, and worth it');
select is(tests.read_as_of(:'hyperion'), 'audiobook', 'a start and a finish leave it');
select public.read_again(:'hyperion', current_date);
select is(tests.read_as_of(:'hyperion'), 'audiobook', 'so does a read again');

-- ------------------------------------------------------------------ change edition

-- Moving the entry to another edition presets her word from that edition's format
-- (hardcover and paperback are paper), in the same transaction as the move.
\set solaris_paper '{"title":"Solaris","source":"openlibrary","openlibrary_edition_key":"OL990016901M","isbn13":"9790000169011","format":"paperback"}'
\set solaris_paper2 '{"title":"Solaris","source":"openlibrary","openlibrary_edition_key":"OL990016902M","isbn13":"9790000169028","format":"hardcover"}'
\set solaris_ebook '{"title":"Solaris","source":"apple","apple_id":"990000169003","isbn13":"9790000169035"}'
\set solaris_audio '{"title":"Solaris","source":"openlibrary","openlibrary_edition_key":"OL990016904M","isbn13":"9790000169042","format":"audiobook"}'
\set solaris_bare '{"title":"Solaris","source":"openlibrary","openlibrary_edition_key":"OL990016905M","isbn13":"9790000169059"}'

select (public.add_to_library(:'solaris_paper')).id as solaris \gset
select public.set_read_as(:'solaris', 'physical');

select public.change_edition(:'solaris', :'solaris_ebook');
select is(tests.read_as_of(:'solaris'), 'ebook', 'an ebook edition: she read it as an ebook');
select public.change_edition(:'solaris', :'solaris_audio');
select is(tests.read_as_of(:'solaris'), 'audiobook', 'an audiobook edition: as an audiobook');
select public.change_edition(:'solaris', :'solaris_paper');
select is(tests.read_as_of(:'solaris'), 'physical', 'a paperback: on paper');

-- Her word on the new edition's format counts, the Book's own where she said none.
select public.change_edition(:'solaris', :'solaris_bare', 'audiobook');
select is(tests.read_as_of(:'solaris'), 'audiobook', 'the format she says for the new edition is the one that presets');

-- A format nobody knows leaves her word alone.
select public.change_edition(:'solaris', :'solaris_paper2');
select public.set_read_as(:'solaris', 'ebook');
select public.change_edition(:'solaris', :'solaris_bare');
select is(tests.read_as_of(:'solaris'), 'ebook', 'an edition of no known format leaves what she said');

-- ... and so does a move to an edition read the same way.
select public.change_edition(:'solaris', :'solaris_audio');
select public.set_read_as(:'solaris', 'physical');
select public.change_edition(:'solaris', :'solaris_paper');
select public.set_read_as(:'solaris', 'audiobook');
select public.change_edition(:'solaris', :'solaris_paper2');
select is(tests.read_as_of(:'solaris'), 'audiobook', 'paper to paper: her own word stays');
select is((select format_override::text from public.library_entries where id = :'solaris'), null, 'and her format word is the Book''s');

-- An unset word stays unset: the edition's format is its default.
select public.set_read_as(:'solaris', null);
select public.change_edition(:'solaris', :'solaris_ebook');
select is(tests.read_as_of(:'solaris'), 'unset', 'a word she never said is not made up');

-- The move and the preset are one statement: a refused move changes nothing.
select (public.add_to_library(:'solaris_audio')).id as solaris_two \gset
select public.set_read_as(:'solaris', 'physical');
select throws_ok(format($$ select public.change_edition(%L, %L) $$, :'solaris', :'solaris_audio'),
  '23505', 'edition_in_library', 'an edition she has as another entry is refused');
select is(tests.read_as_of(:'solaris'), 'physical', 'and her word is as it was');

-- Her own edition presets it too.
select public.set_read_as(:'solaris', 'ebook');
select public.remove_from_library(:'solaris_two');
select public.use_own_edition(:'solaris', '{"format":"hardcover","authors":["Stanisław Lem"],"isbn13":"9781399607735","page_count":300,"language":"en","cover_url":"https://example.com/solaris.jpg"}');
select is(tests.read_as_of(:'solaris'), 'physical', 'her own edition, a hardcover: on paper');

-- ---------------------------------------------------------------------- privacy

select tests.act_as(:'max_id');
select is(tests.read_as_of(:'max_hyperion'), 'unset', 'another member''s entry kept its own');
select is((select count(*)::int from public.library_entries where read_as = 'audiobook'), 0, 'and cannot see hers');

select * from finish();
rollback;
