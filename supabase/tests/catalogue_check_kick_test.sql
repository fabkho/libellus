-- The call to the check, and where its failure shows (social v2a contract §5; review LOW):
--   supabase test db
--
-- The function's address is https only (the call carries a bearer secret). A call that fails (a 401 for
-- a wrong token, a 5xx, a timeout) is recorded where the owner looks: the settings row's last_status
-- and last_error, read from pg_net's response by the next kick, and shown by catalogue_check_status.

begin;
select plan(15);

-- ------------------------------------------------------------- https only

select throws_ok($$ update private.catalogue_check_settings set function_url = 'http://abc.supabase.co/functions/v1/catalogue-check' $$,
  '23514', null, 'a plain http address is refused');
select throws_ok($$ update private.catalogue_check_settings set function_url = 'https://' $$, '23514', null, 'so is an address with no host');
select throws_ok($$ update private.catalogue_check_settings set function_url = 'https://abc.supabase.co/a b' $$, '23514', null, 'and one with a space');
select throws_ok($$ update private.catalogue_check_settings set function_url = 'ftp://abc.supabase.co/f' $$, '23514', null, 'and another scheme');
select lives_ok($$ update private.catalogue_check_settings set function_url = 'https://abc.supabase.co/functions/v1/catalogue-check' $$,
  'an https address is fine');

-- ------------------------------------------------------------- the record of a call

-- One Book waiting, a token in the Vault, nothing called yet.
update public.books set checked_at = now() where owner_id is null and checked_at is null;
insert into public.books (title, authors, source, apple_id) values ('Kick Book', '{A}', 'apple', '9877000000001');
delete from vault.secrets where name = 'catalogue_check_token';
select vault.create_secret(repeat('s', 40), 'catalogue_check_token');
update private.catalogue_check_settings set last_kick_at = null, last_request_id = null, last_status = null, last_error = null, last_status_at = null;

select is(private.catalogue_check_kick(), 'sent', 'a Book is due and the function has an address: the call is sent');
select isnt((select last_request_id from private.catalogue_check_settings), null, 'its request is remembered');
select is((select last_status from private.catalogue_check_settings), null, 'with nothing yet known of its answer');

-- The function answered 401: the next kick records it.
insert into net._http_response (id, status_code, content, error_msg)
select last_request_id, 401, '{"error":"unauthorized"}', null from private.catalogue_check_settings;
update private.catalogue_check_settings set last_kick_at = now() - interval '2 minutes';
select is(private.catalogue_check_kick(), 'sent', 'a minute later the next call is sent');
select is((select (last_status, last_error)::text from private.catalogue_check_settings), '(401,"{""error"":""unauthorized""}")',
  'and the 401 of the one before is recorded, with what it said');
select is(public.catalogue_check_status() ->> 'lastStatus', '401', 'the status shows it');

-- A timeout has no status, only its error.
insert into net._http_response (id, status_code, content, error_msg)
select last_request_id, null, null, 'Timeout of 120000 ms reached' from private.catalogue_check_settings;
update private.catalogue_check_settings set last_kick_at = now() - interval '2 minutes';
select private.catalogue_check_kick();
select is((select (last_status, last_error)::text from private.catalogue_check_settings), '(,"Timeout of 120000 ms reached")', 'a call that timed out is recorded by its error');

-- A call that went through leaves no error.
insert into net._http_response (id, status_code, content, error_msg)
select last_request_id, 200, '{"checked":1}', null from private.catalogue_check_settings;
update private.catalogue_check_settings set last_kick_at = now() - interval '2 minutes';
select private.catalogue_check_kick();
select is((select (last_status, last_error)::text from private.catalogue_check_settings), '(200,)', 'a 200 records its status and no error');

-- Recorded even when nothing is due any more (an idle kick still reads the last answer).
update public.books set checked_at = now() where owner_id is null and checked_at is null;
insert into net._http_response (id, status_code, content, error_msg)
select last_request_id, 502, 'bad gateway', null from private.catalogue_check_settings;
select is(private.catalogue_check_kick(), 'idle', 'nothing is due: idle');
select is((select last_status from private.catalogue_check_settings), 502, 'but the last answer is read all the same');

select * from finish();
rollback;
