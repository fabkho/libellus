-- The reader's highlights, kept server-side (issue #131):
--   supabase test db
--
-- A member saves a highlight in her entry's ebook — a CFI and its section, one
-- of four colours, the words she selected, the fingerprint of the file — and
-- reads it back on another device. Her highlights are hers alone: another
-- member reads none of them, cannot write one on her entry and cannot touch one
-- by its id, directly or through `sync_write`. Last write wins per highlight:
-- a save older than the stored row is ignored and the stored row returned; a
-- removal is a tombstone with no words that beats an older edit, and an edit
-- made after it brings the highlight back. The words are cut at 1000
-- characters; an empty or over-long CFI, an unknown colour, a negative section,
-- a bad fingerprint and a long note are refused. A highlight goes with its
-- entry, stays when the edition changes, and goes with the member's account.
-- `sync_write` takes the write once, by its request id.
--
-- Everything runs in one transaction, so `now()` stands still: the times a save
-- carries are written as offsets from it. Assertions ask about the rows this
-- test made, never about how many rows a table holds.

begin;
select plan(57);

create schema if not exists tests;

-- ------------------------------------------------------------------ fixtures

insert into public.invite_codes (code, label, max_uses) values ('T-HLIGHTS', 'reader highlights test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data,
                          email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-HLIGHTS"}'::jsonb, now(), now(), now());
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

-- What is stored, past the members' own RLS.
create or replace function tests.stored(p_id uuid)
returns public.reader_highlights language sql security definer as $$
  select h from public.reader_highlights h where id = p_id
$$;

create or replace function tests.highlights_of(p_member uuid)
returns bigint language sql security definer as $$
  select count(*) from public.reader_highlights where member_id = p_member
$$;

select tests.member('ada@highlights.pgtap.test') as ada_id \gset
select tests.member('ben@highlights.pgtap.test') as ben_id \gset

grant usage on schema tests to anon, authenticated;
grant execute on all functions in schema tests to anon, authenticated;

\set hash_a '\'aa11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900\''
\set hash_b '\'bb11bb22cc33dd44ee55ff6677889900aa11bb22cc33dd44ee55ff6677889900\''

-- Highlight ids, made on the devices.
\set h1 '\'00000000-0000-4000-8000-000000000001\''
\set h2 '\'00000000-0000-4000-8000-000000000002\''
\set h3 '\'00000000-0000-4000-8000-000000000003\''
\set h4 '\'00000000-0000-4000-8000-000000000004\''
\set h5 '\'00000000-0000-4000-8000-000000000005\''
\set h6 '\'00000000-0000-4000-8000-000000000006\''

select tests.act_as(:'ada_id');
select (public.add_to_library('{"title":"Dune","source":"apple","apple_id":"990000014101"}')).id as dune \gset
select (public.add_to_library('{"title":"Emma","source":"apple","apple_id":"990000014102"}')).id as emma \gset
select (public.add_to_library('{"title":"Solaris","source":"apple","apple_id":"990000014103"}')).id as solaris \gset

select tests.act_as(:'ben_id');
select (public.add_to_library('{"title":"Ubik","source":"apple","apple_id":"990000014104"}')).id as ubik \gset

-- -------------------------------------------------------- her own highlight

reset role;
select tests.act_as(:'ada_id');

select is(
  (public.save_reader_highlight(:h1, :'dune', :hash_a, 'epubcfi(/6/14!/4/2,/1:0,/1:12)', 3, 'sage',
                                'Fear is the mind-killer', null, false, now() - interval '10 minutes')).color,
  'sage', 'she saves a highlight and gets it back');

select results_eq(
  format($$select entry_id, member_id, file_hash, cfi, section_index, color, excerpt, note, deleted_at
             from public.reader_highlights where id = %L$$, :h1),
  format($$values (%L::uuid, %L::uuid, %L::text, 'epubcfi(/6/14!/4/2,/1:0,/1:12)'::text, 3, 'sage'::text,
                   'Fear is the mind-killer'::text, null::text, null::timestamptz)$$, :'dune', :'ada_id', :hash_a),
  'and reads it back: the entry, hers, the file, the range and section, the colour, the words');

select is((public.save_reader_highlight(:h1, :'dune', :hash_a, 'epubcfi(/6/14!/4/2,/1:0,/1:12)', 3, 'rose',
                                        'Fear is the mind-killer', null, false, now() - interval '5 minutes')).color,
  'rose', 'a newer change (another colour) replaces it');
select is((tests.stored(:h1)).color, 'rose', 'and that is what is stored');
select is((tests.stored(:h1)).created_at, now() - interval '10 minutes',
  'it keeps when it was first made');

select is((public.save_reader_highlight(:h2, :'dune', :hash_a, 'epubcfi(/6/16!/4/2,/1:3,/1:9)', 4, 'sky', '', '', false,
                                        now() - interval '9 minutes')).note,
  null, 'an empty note is no note');
select is(
  (public.save_reader_highlight(:h3, :'dune', :hash_b, 'epubcfi(/6/18!/4/2,/1:0,/1:4)', 0, 'lamp', 'Arrakis', 'mine', false,
                                now() - interval '8 minutes')).note,
  'mine', 'her own note is kept');

-- --------------------------------------------------- last write wins per id

select is((public.save_reader_highlight(:h1, :'dune', :hash_a, 'epubcfi(/6/14!/4/2,/1:0,/1:12)', 3, 'lamp',
                                        'Fear is the mind-killer', null, false, now() - interval '1 hour')).color,
  'rose', 'a save from a device that changed it earlier returns the row that stands');
select is((tests.stored(:h1)).color, 'rose', 'and does not overwrite the newer one');

select is((public.save_reader_highlight(:h1, :'dune', :hash_a, 'epubcfi(/6/14!/4/2,/1:0,/1:12)', 3, 'lamp',
                                        'Fear is the mind-killer', null, false, now() - interval '5 minutes')).color,
  'rose', 'the same moment is not newer: the stored row stands');

update public.reader_highlights set color = 'sky', updated_at = now() - interval '2 hours' where id = :h1;
select is((tests.stored(:h1)).color, 'rose', 'a direct update that is not newer changes nothing either');
update public.reader_highlights set color = 'sage', updated_at = now() - interval '1 minute' where id = :h1;
select is((tests.stored(:h1)).color, 'sage', 'a newer one goes through');

select is(
  (public.save_reader_highlight(:h4, :'dune', :hash_a, 'epubcfi(/6/20!/4/2,/1:0,/1:5)', 5, 'sky', 'Ahead', null, false,
                                now() + interval '2 hours')).updated_at <= now(),
  true, 'a change from a clock hours ahead is stamped now');
select ok((tests.stored(:h4)).created_at <= now(), 'and never made after it was changed');

update public.reader_highlights set entry_id = :'emma', member_id = :'ben_id', created_at = now() - interval '9 days',
       updated_at = now() where id = :h1;
select results_eq(
  format($$select entry_id, member_id, created_at from public.reader_highlights where id = %L$$, :h1),
  format($$values (%L::uuid, %L::uuid, %L::timestamptz)$$, :'dune', :'ada_id', now() - interval '10 minutes'),
  'an update cannot move a highlight to another entry or member, nor rewrite when it began');

-- ------------------------------------------------------------- tombstones

select is(
  (public.save_reader_highlight(:h2, :'dune', :hash_a, 'epubcfi(/6/16!/4/2,/1:3,/1:9)', 4, 'sky', 'her words', 'a note', true,
                                now() - interval '4 minutes')).deleted_at,
  now() - interval '4 minutes', 'removing a highlight is a tombstone, stamped when it was removed');
select results_eq(
  format($$select excerpt, note from public.reader_highlights where id = %L$$, :h2),
  $$values (''::text, null::text)$$,
  'the tombstone holds none of her words');

select is(
  (public.save_reader_highlight(:h2, :'dune', :hash_a, 'epubcfi(/6/16!/4/2,/1:3,/1:9)', 4, 'rose', 'older edit', null, false,
                                now() - interval '6 minutes')).deleted_at,
  now() - interval '4 minutes', 'an edit made before the removal does not bring it back');
select is((tests.stored(:h2)).excerpt, '', 'and the words stay gone');

select is(
  (public.save_reader_highlight(:h2, :'dune', :hash_a, 'epubcfi(/6/16!/4/2,/1:3,/1:9)', 4, 'rose', 'again', null, false,
                                now() - interval '1 minute')).deleted_at,
  null, 'an edit made after it does: the highlight is back');
select is((tests.stored(:h2)).excerpt, 'again', 'with the words of the new edit');

select throws_ok(
  format($$update public.reader_highlights set deleted_at = now(), updated_at = now() where id = %L$$, :h3),
  '23514', null, 'a direct write cannot tombstone a highlight and keep its words');

-- --------------------------------------------------------- the words' cap

select is(
  char_length((public.save_reader_highlight(:h5, :'dune', :hash_a, 'epubcfi(/6/22!/4/2,/1:0,/1:5)', 6, 'lamp',
                                            repeat('é', 1500), null, false, now() - interval '3 minutes')).excerpt),
  1000, 'words past 1000 characters are cut, not refused');
select throws_ok(
  format($$insert into public.reader_highlights (id, entry_id, file_hash, cfi, section_index, color, excerpt)
           values (%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', %L)$$, :h6, :'emma', :hash_a, repeat('a', 1001)),
  '23514', null, 'the table refuses more, whatever a client sends');

-- ------------------------------------------------------------ the shape

select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, '', 0, 'sky', 'x', null, false, now())$$, :h6, :'emma', :hash_a),
  '22023', 'highlight_invalid', 'an empty CFI is refused');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, %L, 0, 'sky', 'x', null, false, now())$$, :h6, :'emma', :hash_a, repeat('a', 2001)),
  '22023', 'highlight_invalid', 'a CFI over 2000 characters is refused');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'neon', 'x', null, false, now())$$, :h6, :'emma', :hash_a),
  '22023', 'highlight_invalid', 'a colour that is not one of the four is refused');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', -1, 'sky', 'x', null, false, now())$$, :h6, :'emma', :hash_a),
  '22023', 'highlight_invalid', 'a negative section is refused');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, 'abc123', 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', null, false, now())$$, :h6, :'emma'),
  '22023', 'highlight_invalid', 'a fingerprint that is not a SHA-256 is refused');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', %L, false, now())$$, :h6, :'emma', :hash_a, repeat('n', 2001)),
  '22023', 'highlight_invalid', 'a note over 2000 characters is refused');
select throws_ok(
  format($$select public.save_reader_highlight(null, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', null, false, now())$$, :'emma', :hash_a),
  '22023', 'highlight_invalid', 'and so is no id');
select throws_ok(
  format($$insert into public.reader_highlights (id, entry_id, file_hash, cfi, section_index, color)
           values (%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'neon')$$, :h6, :'emma', :hash_a),
  '23514', null, 'the table refuses an unknown colour too');

-- --------------------------------------------------------- hers alone

reset role;
select tests.act_as(:'ben_id');

select is_empty(format($$select 1 from public.reader_highlights where id = %L$$, :h1),
  'another member reads none of her highlights');
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', null, false, now())$$, :h6, :'dune', :hash_a),
  'P0002', 'entry_not_found', 'and cannot save one on her entry');
select throws_ok(
  format($$insert into public.reader_highlights (id, member_id, entry_id, file_hash, cfi, section_index, color)
           values (%L, %L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky')$$, :h6, :'ben_id', :'dune', :hash_a),
  '42501', null, 'nor write one for it directly');
update public.reader_highlights set color = 'sky', updated_at = now() where id = :h1;
select is((tests.stored(:h1)).color, 'sage', 'nor change hers: RLS hands him no row to write');

select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', null, false, now())$$, :h1, :'ubik', :hash_a),
  '22023', 'highlight_invalid', 'he cannot take over the id of one of hers on his own entry');
select is((tests.stored(:h1)).member_id, :'ada_id'::uuid, 'which stays hers');

select is(
  (public.save_reader_highlight(:h6, :'ubik', :hash_b, 'epubcfi(/6/12!/4/2,/1:0,/1:3)', 2, 'lamp', 'Ubik', null, false,
                                now() - interval '1 minute')).member_id,
  :'ben_id'::uuid, 'his own highlight on his own entry is his');
select is(tests.highlights_of(:'ben_id'), 1::bigint, 'and the only one he has');

-- ----------------------------------------------------------- sync_write

reset role;
select tests.act_as(:'ada_id');
select gen_random_uuid() as req \gset

select is(
  (public.sync_write(:'req', 'save_reader_highlight', jsonb_build_object(
     'p_id', '00000000-0000-4000-8000-0000000000a1', 'p_entry_id', :'emma', 'p_file_hash', :hash_a,
     'p_cfi', 'epubcfi(/6/4!/4/2,/1:0,/1:7)', 'p_section_index', 1, 'p_color', 'sage',
     'p_excerpt', 'Emma Woodhouse', 'p_note', null, 'p_deleted', false,
     'p_at', now() - interval '7 minutes', 'p_created_at', now() - interval '7 minutes'))) ->> 'replayed',
  'false', 'a highlight queued offline is applied through sync_write');
select is((tests.stored('00000000-0000-4000-8000-0000000000a1')).excerpt, 'Emma Woodhouse',
  'as the same function the online call uses');
select is(
  (public.sync_write(:'req', 'save_reader_highlight', jsonb_build_object(
     'p_id', '00000000-0000-4000-8000-0000000000a1', 'p_entry_id', :'emma', 'p_file_hash', :hash_a,
     'p_cfi', 'epubcfi(/6/4!/4/2,/1:0,/1:7)', 'p_section_index', 1, 'p_color', 'rose',
     'p_excerpt', 'Emma Woodhouse', 'p_at', now() - interval '6 minutes'))) ->> 'replayed',
  'true', 'sent again with the same request id it changes nothing');
select is((tests.stored('00000000-0000-4000-8000-0000000000a1')).color, 'sage', 'the first send stands');

select is(
  (public.sync_write(gen_random_uuid(), 'save_reader_highlight', jsonb_build_object(
     'p_id', '00000000-0000-4000-8000-0000000000a1', 'p_entry_id', :'emma', 'p_file_hash', :hash_a,
     'p_cfi', 'epubcfi(/6/4!/4/2,/1:0,/1:7)', 'p_section_index', 1, 'p_color', 'lamp',
     'p_excerpt', 'Emma Woodhouse', 'p_deleted', true, 'p_at', now() - interval '30 minutes'))) ->> 'replayed',
  'false', 'a removal that was made before a newer edit, sent later, is applied as a no-op');
select is((tests.stored('00000000-0000-4000-8000-0000000000a1')).deleted_at, null, 'and does not remove it');

reset role;
select tests.act_as(:'ben_id');
select throws_ok(
  format($$select public.sync_write(gen_random_uuid(), 'save_reader_highlight', jsonb_build_object(
     'p_id', %L, 'p_entry_id', %L, 'p_file_hash', %L, 'p_cfi', 'epubcfi(/6/4!/4/2:0)', 'p_section_index', 0,
     'p_color', 'sky', 'p_at', now()))$$, '00000000-0000-4000-8000-0000000000a1', :'ubik', :hash_a),
  '22023', 'highlight_invalid', 'sync_write, which runs as its owner, still never touches another member''s highlight');
select is((tests.stored('00000000-0000-4000-8000-0000000000a1')).member_id, :'ada_id'::uuid, 'it stays hers');

-- ------------------------------------------------------- another edition

reset role;
select tests.act_as(:'ada_id');

select ok(
  (select count(*) from public.reader_highlights where entry_id = :'dune' and file_hash = :hash_a and deleted_at is null) >= 1
  and (select count(*) from public.reader_highlights where entry_id = :'dune' and file_hash = :hash_b) = 1,
  'one entry holds highlights from two copies of its book, each with its own fingerprint');

-- ------------------------------------------------------- signed out, gone

reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2:0)', 0, 'sky', 'x', null, false, now())$$, :h6, :'dune', :hash_a),
  '42501', null, 'a signed-out caller cannot save a highlight');

reset role;
select tests.act_as(:'ada_id');
select lives_ok(
  format($$select public.save_reader_highlight(%L, %L, %L, 'epubcfi(/6/2!/4/2,/1:0,/1:5)', 0, 'sky', 'x', null, false, now())$$,
         '00000000-0000-4000-8000-0000000000b1', :'solaris', :hash_a),
  'a highlight on her third book, to watch it go');

reset role;
delete from public.library_entries where id = :'solaris';
select is(tests.stored('00000000-0000-4000-8000-0000000000b1'), null, 'a highlight goes with its entry');

select tests.act_as(:'ben_id');
select public.delete_my_account();
reset role;
select is(tests.highlights_of(:'ben_id'), 0::bigint, 'and a member''s highlights go with her account');
select ok(tests.highlights_of(:'ada_id') > 0, 'while another member''s stay');

-- ------------------------------------------------------------ the table

select ok((select relrowsecurity from pg_class where oid = 'public.reader_highlights'::regclass),
  'row level security is on');
select ok(
  not has_table_privilege('anon', 'public.reader_highlights', 'select')
  and not has_table_privilege('anon', 'public.reader_highlights', 'insert'),
  'anon has nothing on the table');
select ok(
  has_table_privilege('authenticated', 'public.reader_highlights', 'select')
  and has_table_privilege('authenticated', 'public.reader_highlights', 'insert')
  and has_table_privilege('authenticated', 'public.reader_highlights', 'update')
  and not has_table_privilege('authenticated', 'public.reader_highlights', 'delete'),
  'a member reads and writes her highlights, and deletes none by hand');

select * from finish();
rollback;
