-- Own covers, part 1 (20261108010000_cover_store.sql; docs/plans/owned-covers.md §3, §4): the database decides which
-- covers are to be stored, the cover-store function (PR 2) stores them.
--   supabase test db
--
--   * the reconcile queues a Book in a Library with no key and a storable cover, whichever way it got there (add,
--     import write, change edition, own edition, fill_book_covers, the catalogue check), and never one outside every
--     Library or on a host we do not store from
--   * the key follows the picture: another artwork clears key, widths and queue row; the same value and a size change
--     do not; cover_store_done's own write does not fire the trigger
--   * claim, reserve, done (compare-and-swap, thumbhash only into an empty one), failed (backoff, throttled, gone)
--   * the tick, the kick, owner_cover_status, and who may call what

begin;
select plan(114);
set local client_min_messages = warning;

create schema if not exists tests;

insert into public.invite_codes (code, label, max_uses) values ('T-COVER-STORE', 'cover store test', 5);

create or replace function tests.member(p_email text)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          p_email, '{"invite_code":"T-COVER-STORE"}'::jsonb, now(), now(), now());
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
create or replace function tests.act_as_service()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end;
$$;
-- A queue row, as a text.
create or replace function tests.q(p_book uuid)
returns text language sql as $$
  select coalesce((select concat_ws(',', state, attempts, coalesce(last_error, '-')) from private.cover_store_queue where book_id = p_book), 'none')
$$;
create or replace function tests.stored(p_book uuid)
returns text language sql as $$
  select coalesce((select concat_ws(',', coalesce(cover_key, '-'), coalesce(cover_widths::text, '-')) from public.books where id = p_book), 'none')
$$;
create or replace function tests.due_in(p_book uuid)
returns interval language sql as $$
  select due_at - now() from private.cover_store_queue where book_id = p_book
$$;
create or replace function tests.hex(p_n integer)
returns text language sql immutable as $$ select lpad(to_hex(p_n), 32, '0') $$;

grant usage on schema tests to public;
grant execute on all functions in schema tests to public;

select tests.member('ida@cover-store.test') as ida_id \gset
select tests.member('max@cover-store.test') as max_id \gset

\set apple_600 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/cs0001.jpg/600x900bb.jpg'
\set apple_120 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/aa/bb/cc/cs0001.jpg/120x180bb.webp'
\set apple_other 'https://is1-ssl.mzstatic.com/image/thumb/Publication/v4/dd/ee/ff/cs0002.jpg/600x900bb.jpg'
\set ol_l 'https://covers.openlibrary.org/b/id/9100001-L.jpg'
\set ol_m_default 'https://covers.openlibrary.org/b/id/9100001-M.jpg?default=false'
\set ol_other 'https://covers.openlibrary.org/b/id/9100002-L.jpg'
\set goodreads 'https://i.gr-assets.com/images/S/compressed.photo.goodreads.com/books/1/9100003.jpg'

-- ---------------------------------------------------------------- what is built

select has_column('public', 'books', 'cover_key', 'a Book knows its stored copy');
select has_column('public', 'books', 'cover_widths', 'and its widths');
select is((select enabled from private.cover_store_settings), false, 'storing is off until the owner turns it on');
select is((select count(*)::int from private.cover_store_settings), 1, 'with one settings row');
select throws_ok(
  $$ insert into public.books (title, authors, source, isbn13, cover_key, cover_widths)
     values ('Bad Key', '{A}', 'import', '9790000091001', 'not-a-key', '{120}') $$,
  '23514', null, 'a key is 32 hex characters');
select throws_ok(
  $$ insert into public.books (title, authors, source, isbn13, cover_key, cover_widths)
     values ('No Widths', '{A}', 'import', '9790000091002', '00000000000000000000000000000001', null) $$,
  '23514', null, 'a key comes with its widths');
select throws_ok(
  $$ insert into public.books (title, authors, source, isbn13, cover_key, cover_widths)
     values ('Tiny Width', '{A}', 'import', '9790000091003', '00000000000000000000000000000001', '{8}') $$,
  '23514', null, 'a width is 16 to 2000');
select is(private.cover_artwork(null), null, 'no cover, no artwork');
select is(private.cover_artwork(:'apple_600'), private.cover_artwork(:'apple_120'), 'Apple''s sizes and formats are one artwork');
select isnt(private.cover_artwork(:'apple_600'), private.cover_artwork(:'apple_other'), 'another Apple file is another artwork');
select is(private.cover_artwork(:'ol_l'), private.cover_artwork(:'ol_m_default'), 'Open Library''s sizes and ?default=false are one artwork');
select isnt(private.cover_artwork(:'ol_l'), private.cover_artwork(:'ol_other'), 'another Open Library cover is another artwork');

-- ------------------------------------------------- each way a Book gets its cover

-- Whatever else the database holds is not this test's: only these Books are looked at.

-- add_to_library
select tests.act_as(:'ida_id');
select (public.add_to_library(jsonb_build_object('title', 'Cs Added', 'authors', jsonb_build_array('A'), 'source', 'apple',
  'apple_id', '990000009101', 'cover_url', :'apple_600'), 'want_to_read', null)).book_id as added \gset
-- import_books
select public.import_books(jsonb_build_array(jsonb_build_object('key', 'goodreads:cs1', 'status', 'want_to_read',
  'book', jsonb_build_object('title', 'Cs Imported', 'authors', jsonb_build_array('A'), 'source', 'import',
    'isbn13', '9790000091104', 'cover_url', :'ol_l'))));
-- a Goodreads cover
select (public.add_to_library(jsonb_build_object('title', 'Cs Goodreads', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL9900011M', 'isbn13', '9790000091111', 'cover_url', :'goodreads'), 'want_to_read', null)).book_id as gr \gset
-- a Book without a cover, to get one from fill_book_covers and from the check
select (public.add_to_library(jsonb_build_object('title', 'Cs Filled', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL9900021M', 'isbn13', '9790000091128'), 'want_to_read', null)).book_id as filled \gset
select (public.add_to_library(jsonb_build_object('title', 'Cs Checked', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL990009113M'), 'want_to_read', null)).book_id as checked \gset
-- change_edition: her entry moves to another edition, which has a cover
select (public.add_to_library(jsonb_build_object('title', 'Cs Moving', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL9900031M', 'isbn13', '9790000091135'), 'want_to_read', null)).id as moving_entry \gset
select public.change_edition(:'moving_entry', jsonb_build_object('title', 'Cs Moving', 'authors', jsonb_build_array('A'), 'source', 'apple',
  'apple_id', '990000009114', 'cover_url', :'apple_other'));
-- an own edition (a Manual Book), with a cover on a host we store from and one with a cover elsewhere
select (public.add_to_library(jsonb_build_object('title', 'Cs Own', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL9900041M', 'isbn13', '9790000091142'), 'want_to_read', null)).id as own_entry \gset
select public.use_own_edition(:'own_entry', jsonb_build_object('format', 'paperback', 'cover_url', :'ol_other'));
select (public.add_to_library(jsonb_build_object('title', 'Cs Elsewhere', 'authors', jsonb_build_array('A'), 'source', 'openlibrary',
  'openlibrary_edition_key', 'OL9900051M', 'isbn13', '9790000091159'), 'want_to_read', null)).id as elsewhere_entry \gset
select public.use_own_edition(:'elsewhere_entry', jsonb_build_object('format', 'paperback', 'cover_url', 'https://example.com/cover.jpg'));
select book_id as own_book from public.library_entries where id = :'own_entry' \gset
select book_id as elsewhere_book from public.library_entries where id = :'elsewhere_entry' \gset
select book_id as moving from public.library_entries where id = :'moving_entry' \gset
select id as imported from public.books where isbn13 = '9790000091104' \gset
reset role;
-- fill_book_covers and the check
select tests.act_as(:'ida_id');
select public.fill_book_covers(jsonb_build_array(jsonb_build_object('book_id', :'filled', 'cover_url', :'ol_m_default')));
reset role;
select public.catalogue_check_save(:'checked', jsonb_build_object('title', 'Cs Checked', 'cover_url', 'https://covers.openlibrary.org/b/id/9100004-L.jpg'));
-- outside every Library, and a Library's Book once nobody holds it
insert into public.books (title, authors, source, isbn13, cover_url) values ('Cs Nobodys', '{A}', 'import', '9790000091166', :'apple_600') returning id as nobodys \gset

select is(tests.q(:'added'), 'none', 'a Book is not queued the moment it is added (the reconcile finds it)');
select is(private.cover_store_reconcile() >= 7, true, 'the reconcile queues the Books of a Library');
select is(tests.q(:'added'), 'queued,0,-', 'added with add_to_library: queued');
select is(tests.q(:'imported'), 'queued,0,-', 'written by an import: queued');
select is(tests.q(:'gr'), 'queued,0,-', 'a Goodreads cover: queued (stored like the others)');
select is(tests.q(:'moving'), 'queued,0,-', 'an edition she changed to: queued');
select is(tests.q(:'own_book'), 'queued,0,-', 'her own edition with a cover we store from: queued');
select is(tests.q(:'filled'), 'queued,0,-', 'a cover filled by fill_book_covers: queued');
select is(tests.q(:'checked'), 'queued,0,-', 'a cover the catalogue check filled: queued');
select is(tests.q(:'nobodys'), 'none', 'a Book in nobody''s Library is not queued');
select is(tests.q(:'elsewhere_book'), 'none', 'a cover on another host is not queued (v1)');
select is(private.cover_store_reconcile(), 0, 'a second reconcile finds nothing new');
select is((select source_url from private.cover_store_queue where book_id = :'added'), :'apple_600', 'the queue row names the cover');

-- ------------------------------------------------------------ claim and done

-- The rest of the database's queue is not this test's: only these seven Books are in it from here.
delete from private.cover_store_queue
 where book_id not in (:'added', :'imported', :'gr', :'moving', :'own_book', :'filled', :'checked');

select tests.act_as_service();
select is((select count(*)::int from public.cover_store_claim('r1', 3)), 3, 'claim leases as many Books as asked');
select is((select count(*)::int from public.cover_store_claim('r2', 500)), 4, 'a second runner is handed the rest (a batch is 20 at most)');
select is((select count(*)::int from public.cover_store_claim('r3', 20)), 0, 'a leased Book is not handed out again');
reset role;
select is((select count(*)::int from private.cover_store_queue where state = 'leased' and leased_until > now() + interval '160 seconds'), 7,
  'every lease runs 170 seconds');
update private.cover_store_queue set leased_by = 'r1' where state = 'leased';

-- reserve, done
select tests.act_as_service();
select is(public.cover_store_reserve(tests.hex(1)), true, 'a key is reserved before anything is uploaded');
select is(public.cover_store_reserve(tests.hex(1)), true, 'and again (an image two Books share)');
select is(public.cover_store_done(:'added', :'apple_600', tests.hex(1), '{600,360,240,120}', 51000, 'image/webp', 'aGFzaA==', '#AABBCC', '#112233'),
  true, 'done stores the copy');
reset role;
select is(tests.stored(:'added'), tests.hex(1) || ',{120,240,360,600}', 'the Book has its key and its widths, ascending');
select is((select cover_thumbhash from public.books where id = :'added'), 'aGFzaA==', 'and a thumbhash it had none of');
select is((select (cover_dominant, cover_secondary)::text from public.books where id = :'added'), '(#aabbcc,#112233)', 'and its two colours, lowercased');
select is(tests.q(:'added'), 'none', 'its queue row is gone');
select is((select (widths, bytes, content_type)::text from private.cover_objects where key = tests.hex(1)), '("{120,240,360,600}",51000,image/webp)', 'the object knows what was stored');
select isnt((select stored_at from private.cover_objects where key = tests.hex(1)), null, 'and when');

-- done's own write does not fire the key-clearing trigger (it writes cover_key, widths, thumbhash, colours)
select is(tests.stored(:'added') <> '-,-', true, 'cover_store_done''s write did not clear the key it wrote');

select tests.act_as_service();
select is(public.cover_store_done(:'added', :'apple_600', tests.hex(1), '{600,360,240,120}', 51000), true, 'a Book done twice answers true');
reset role;
select is(tests.stored(:'added'), tests.hex(1) || ',{120,240,360,600}', 'and changes nothing');

-- a thumbhash goes only into an empty one
update public.books set cover_thumbhash = 'kept', cover_dominant = '#010203', cover_secondary = '#040506' where id = :'imported';
select tests.act_as_service();
select public.cover_store_reserve(tests.hex(2));
select is(public.cover_store_done(:'imported', :'ol_l', tests.hex(2), '{180,353}', 66000, 'image/jpeg', 'other', '#ffffff', '#000000'),
  true, 'a Book that has a thumbhash is stored too');
reset role;
select is((select (cover_thumbhash, cover_dominant, cover_secondary)::text from public.books where id = :'imported'),
  '(kept,#010203,#040506)', 'its thumbhash and colours stay');

-- compare-and-swap: the cover changed while the runner worked
update public.books set cover_url = 'https://covers.openlibrary.org/b/id/9100009-L.jpg' where id = :'gr';
select is(tests.q(:'gr'), 'none', 'a changed cover took its Book out of the queue (the trigger)');
select tests.act_as_service();
select public.cover_store_reserve(tests.hex(3));
select is(public.cover_store_done(:'gr', :'goodreads', tests.hex(3), '{300}', 40000, 'image/jpeg'), false,
  'done for a cover that has changed since is refused');
select is(public.cover_store_done(gen_random_uuid(), :'goodreads', tests.hex(3), '{300}', 40000), false, 'and for a Book that is gone');
select is(public.cover_store_done(:'moving', :'apple_other', tests.hex(4), '{600}', 1), false, 'a key nobody reserved is refused');
reset role;
select is(tests.stored(:'gr'), '-,-', 'the Book has no key');
select is(private.cover_store_reconcile() >= 1, true, 'the reconcile queues it again with its new cover');
select is(tests.q(:'gr'), 'queued,0,-', 'queued, as new');

-- ------------------------------------------------------- the key follows the picture

update public.books set cover_url = cover_url where id = :'added';
select is(tests.stored(:'added'), tests.hex(1) || ',{120,240,360,600}', 'an identical-value cover_url update keeps the key');
update public.books set cover_url = :'apple_120' where id = :'added';
select is(tests.stored(:'added'), tests.hex(1) || ',{120,240,360,600}', 'an Apple size and format change keeps it');
update public.books set cover_url = :'ol_m_default' where id = :'imported';
select is(tests.stored(:'imported'), tests.hex(2) || ',{180,353}', 'an Open Library size change keeps it');
update public.books set cover_url = :'apple_600' where id = :'added';

-- a queue row for the Book, to see it go with the key
insert into private.cover_store_queue (book_id, source_url, state, last_error) values (:'added', :'apple_600', 'gone', 'gone');
update public.books set cover_url = :'apple_other' where id = :'added';
select is(tests.stored(:'added'), '-,-', 'another artwork clears the key and the widths');
select is(tests.q(:'added'), 'none', 'and the queue row, so a gone Book tries again with its new cover');
update public.books set cover_url = null where id = :'imported';
select is(tests.stored(:'imported'), '-,-', 'no cover clears them too');
select is(private.cover_store_reconcile() >= 1 and tests.q(:'added') = 'queued,0,-' and tests.q(:'imported') = 'none', true,
  'the reconcile queues the one with a cover and not the one without');

-- ------------------------------------------------------------------ reserve

select tests.act_as_service();
select public.cover_store_reserve(tests.hex(10));
reset role;
update private.cover_objects set orphaned_at = now() - interval '40 days' where key = tests.hex(10);
select tests.act_as_service();
select is(public.cover_store_reserve(tests.hex(10)), true, 'a key about to be deleted is reserved again in time');
reset role;
select is((select orphaned_at from private.cover_objects where key = tests.hex(10)), null, 'and is no longer an orphan');
update private.cover_objects set deleting_at = now() where key = tests.hex(10);
select tests.act_as_service();
select is(public.cover_store_reserve(tests.hex(10)), false, 'reserve refuses while GC is deleting the image');
select is(public.cover_store_done(:'added', :'apple_other', tests.hex(10), '{600}', 1), false, 'and a copy of it is not recorded');
reset role;

-- ----------------------------------------------------- claim, failed, backoff

-- lease the Book in question to a runner of ours
update private.cover_store_queue set due_at = now() where book_id = :'added';
select tests.act_as_service();
select is((select count(*)::int from public.cover_store_claim('rb', 500) c where c.book_id = :'added'), 1, 'a due Book is handed out');
select is(public.cover_store_failed(:'added', 'not-the-runner', 'timeout'), false, 'only the runner holding the lease says how it went');
select throws_ok(format($$ select public.cover_store_failed(%L, 'rb', 'nonsense') $$, :'added'), '22023', 'reason_invalid', 'an unknown reason is refused');
select is(public.cover_store_failed(:'added', 'rb', 'timeout'), true, 'a timeout is booked');
reset role;
select is(tests.q(:'added'), 'queued,1,timeout', 'again, one attempt counted');
select is(tests.due_in(:'added') between interval '30 seconds' and interval '90 seconds', true, 'after a minute');

create or replace function tests.fail_again(p_book uuid, p_reason text)
returns boolean language plpgsql as $$
begin
  update private.cover_store_queue set state = 'leased', leased_by = 'rb', leased_until = now() + interval '170 seconds' where book_id = p_book;
  return public.cover_store_failed(p_book, 'rb', p_reason);
end;
$$;
select tests.fail_again(:'added', 'host_error');
select is(tests.due_in(:'added') between interval '9 minutes' and interval '11 minutes', true, 'then ten minutes');
select tests.fail_again(:'added', 'not_image');
select is(tests.due_in(:'added') between interval '59 minutes' and interval '61 minutes', true, 'an hour');
select tests.fail_again(:'added', 'too_large');
select is(tests.due_in(:'added') between interval '5 hours 59 minutes' and interval '6 hours 1 minute', true, 'six hours');
select tests.fail_again(:'added', 'r2_error');
select is(tests.due_in(:'added') between interval '23 hours 59 minutes' and interval '24 hours 1 minute', true, 'a day');
select tests.fail_again(:'added', 'r2_error');
select is(tests.q(:'added'), 'failed,6,r2_error', 'then failed');
select is(tests.due_in(:'added') between interval '6 days 23 hours' and interval '7 days 1 hour', true, 'to be tried again in a week');
select is(private.cover_store_reconcile(), 0, 'the reconcile does not queue a failed Book again');

-- throttled and deleting wait ten minutes and count no attempt
update private.cover_store_queue set state = 'queued', attempts = 2, last_error = null, due_at = now() where book_id = :'added';
select tests.fail_again(:'added', 'throttled');
select is(tests.q(:'added'), 'queued,2,throttled', 'throttled counts no attempt');
select is(tests.due_in(:'added') between interval '9 minutes' and interval '11 minutes', true, 'and waits ten minutes');
select tests.fail_again(:'added', 'deleting');
select is(tests.q(:'added'), 'queued,2,deleting', 'a key being deleted waits too');
select is((select count(*)::int from private.cover_store_queue where book_id = :'added' and due_at > now()), 1, 'not due now');

-- gone and unsupported_url are terminal
select tests.fail_again(:'added', 'gone');
select is(tests.q(:'added'), 'gone,2,gone', 'a cover that is not there is gone');
select is(private.cover_store_reconcile(), 0, 'and is not queued again by the reconcile');
update public.books set cover_url = :'apple_600' where id = :'added';
select is(tests.q(:'added'), 'none', 'until its cover changes');
select is(private.cover_store_reconcile() >= 1 and tests.q(:'added') = 'queued,0,-', true, 'when the reconcile queues it again');
select tests.fail_again(:'added', 'unsupported_url');
select is(tests.q(:'added'), 'unsupported,0,unsupported_url', 'a URL we cannot size is unsupported, terminal');

-- a lease that ran out is an attempt, and its Book is handed out again
update private.cover_store_queue set state = 'leased', leased_by = 'dead', leased_until = now() - interval '1 second', attempts = 0, due_at = now()
 where book_id = :'moving';
select tests.act_as_service();
select is((select count(*)::int from public.cover_store_claim('rc', 500) c where c.book_id = :'moving'), 1, 'a Book whose runner died is handed out again');
reset role;
select is(tests.q(:'moving'), 'leased,1,lease_expired', 'with an attempt counted');

-- a Book nobody holds any more is dropped at claim time
delete from public.library_entries where book_id = :'own_book';
update private.cover_store_queue set state = 'queued', due_at = now() where book_id = :'own_book';
select tests.act_as_service();
select is((select count(*)::int from public.cover_store_claim('rd', 500) c where c.book_id = :'own_book'), 0, 'a Book that left every Library is not handed out');
reset role;
select is(tests.q(:'own_book'), 'none', 'and its row is dropped');

-- the cascade
select is(tests.q(:'moving') <> 'none', true, 'a Book with a queue row');
delete from public.library_entries where book_id = :'moving';
delete from public.books where id = :'moving';
select is(tests.q(:'moving'), 'none', 'is deleted with its queue row');

-- ------------------------------------------------------------ tick and kick

select is(private.cover_store_tick(), 'off', 'the tick does nothing while the job is off');
update private.cover_store_settings set enabled = true;
update private.cover_store_queue set state = 'failed', due_at = now() - interval '1 minute' where book_id = :'filled';
select is(private.cover_store_tick(), 'off', 'turned on with no address, it is still not sent (off)');
select is(tests.q(:'filled'), 'queued,5,-', 'the tick tries a failed Book again after its week, one more time');
update private.cover_store_queue set due_at = now() where book_id = :'filled';
update private.cover_store_settings set function_url = 'https://example.invalid/functions/v1/cover-store';
select is(private.cover_store_kick(false), 'busy', 'a run is never kicked while another holds a lease');
update private.cover_store_queue set state = 'queued', leased_by = null, leased_until = null where state = 'leased';
select is(private.cover_store_kick(false), 'unavailable', 'with no token in the Vault it is not sent');
select vault.create_secret('test-token', 'cover_store_token');
select is(private.cover_store_kick(false), 'sent', 'with one it is sent');
select is(private.cover_store_kick(false), 'debounced', 'the tick does not send twice within the interval');
select is(private.cover_store_kick(true), 'sent', 'a run''s own kick is not held back');
delete from private.cover_store_queue;
select is(private.cover_store_kick(true), 'idle', 'nothing due: nothing is sent');
update private.cover_store_settings set enabled = false;
select is(private.cover_store_kick(true), 'off', 'and nothing while off');

-- ------------------------------------------------------------ the owner's counts

update public.books set cover_key = tests.hex(1), cover_widths = '{120,600}' where id = :'filled';
select tests.act_as(:'max_id');
select throws_ok($$ select public.owner_cover_status() $$, '42501', 'not_owner', 'a member who is not the owner reads no counts');
reset role;
update private.instance_owner set owner_id = :'ida_id';
select tests.act_as(:'ida_id');
select is(public.owner_cover_status() ->> 'enabled', 'false', 'the owner reads the counts');
select is((select jsonb_typeof(public.owner_cover_status() -> 'warnings')), 'array', 'with their warnings');
select is((public.owner_cover_status() ->> 'stored')::int >= 1, true, 'stored Books are counted');
select is((public.owner_cover_status() ->> 'not_storable')::int >= 1, true, 'and Books on other hosts');
reset role;
update private.cover_objects set bytes = 6000000000 where key = tests.hex(1);
select tests.act_as(:'ida_id');
select is(public.owner_cover_status() -> 'warnings', '["stored_bytes_over_5gb"]'::jsonb, 'stored bytes past 5 GB are warned of');
reset role;

-- rotating the secret: every Book loses its copy, the objects stay
select is(private.cover_store_rekey() >= 1, true, 'a rekey clears every stored copy');
select is((select count(*)::int from public.books where cover_key is not null), 0, 'of every Book');
select is((select count(*)::int from private.cover_objects where key = tests.hex(1)), 1, 'and leaves the objects, which GC deletes after the grace');

-- ------------------------------------------------------------------- grants

select is(
  (select count(*)::int from (values
    ('private.cover_artwork(text)'), ('private.books_clear_cover_key()'), ('private.cover_store_reconcile()'),
    ('private.cover_store_due()'), ('private.cover_store_kick(boolean)'), ('private.cover_store_tick()'),
    ('private.cover_store_rekey()'),
    ('public.cover_store_claim(text, integer)'), ('public.cover_store_reserve(text)'),
    ('public.cover_store_done(uuid, text, text, integer[], bigint, text, text, text, text)'),
    ('public.cover_store_failed(uuid, text, text)'), ('public.cover_store_kick(boolean)')) f (fn)
    where has_function_privilege('authenticated', f.fn, 'execute') or has_function_privilege('anon', f.fn, 'execute')),
  0, 'members and anon can call none of the functions');
select is(
  (select count(*)::int from (values
    ('public.cover_store_claim(text, integer)'), ('public.cover_store_reserve(text)'),
    ('public.cover_store_done(uuid, text, text, integer[], bigint, text, text, text, text)'),
    ('public.cover_store_failed(uuid, text, text)'), ('public.cover_store_kick(boolean)')) f (fn)
    where has_function_privilege('service_role', f.fn, 'execute')),
  5, 'the store''s functions are the service role''s');
select ok(not has_function_privilege('service_role', 'private.cover_store_tick()', 'execute'), 'the tick is pg_cron''s alone');
select ok(has_function_privilege('authenticated', 'public.owner_cover_status()', 'execute') and not has_function_privilege('anon', 'public.owner_cover_status()', 'execute'),
  'the owner''s counts are for signed-in members (the owner check is inside)');
select is(
  (select count(*)::int from (values ('private.cover_store_queue'), ('private.cover_objects'), ('private.cover_store_settings')) t (tbl)
    where has_table_privilege('authenticated', t.tbl, 'select') or has_table_privilege('anon', t.tbl, 'select')),
  0, 'the tables are no member''s');
select is(
  (select count(*)::int from cron.job where jobname = 'cover-store-tick') in (0, 1), true, 'the tick is scheduled where pg_cron is');

select * from finish();
rollback;
