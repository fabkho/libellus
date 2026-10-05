-- Supabase lints that stay fixed:
--   supabase test db
--
-- The foreign key from accounts to invite_codes is indexed, and `citext` lives in
-- `extensions`, not `public`, while the column that uses it, the lookup that spells
-- it and the unique index on it keep working.

begin;
select plan(8);

insert into public.invite_codes (code, label, max_uses) values ('T-Lint-Code', 'lint test', 5);

select is(
  (select count(*)::int from pg_index i
   where i.indrelid = 'public.accounts'::regclass
     and (select attname from pg_attribute where attrelid = i.indrelid and attnum = i.indkey[0]) = 'invite_code_id'),
  1, 'accounts.invite_code_id is the first column of an index');

select is(
  (select n.nspname::text from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'citext'),
  'extensions', 'citext lives in the extensions schema');
select is(
  (select t.typnamespace::regnamespace::text || '.' || t.typname from pg_attribute a join pg_type t on t.oid = a.atttypid
   where a.attrelid = 'public.invite_codes'::regclass and a.attname = 'code'),
  'extensions.citext', 'invite_codes.code is still citext, now the one in extensions');

select is(
  (select id from public.invite_codes where code = 't-lint-code'::extensions.citext),
  (select id from public.invite_codes where code = 'T-LINT-CODE'::extensions.citext),
  'the column still compares without regard to case');
select is(public.invite_code_status('t-LINT-code'), 'valid', 'the invite check, which pins its own search_path, still finds the code');
select is(public.invite_code_status('T-LINT-NOPE'), 'invalid', 'and still refuses a wrong one');
select throws_ok(
  $$insert into public.invite_codes (code, label, max_uses) values ('T-LINT-CODE', 'duplicate', 1)$$,
  '23505', null, 'the unique index still treats codes as one regardless of case');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'citext%'),
  0, 'no citext function is left in public');

select * from finish();
rollback;
