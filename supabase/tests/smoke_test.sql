-- The database suite's first test: proves `supabase test db` runs against the
-- libellus stack with pgTAP available. Real rules (invite gate, RLS, derived
-- status, session checks) arrive with the migrations that introduce them.
begin;

select plan(2);

select has_schema('public', 'the public schema exists');
select has_schema('auth', 'Supabase Auth is installed');

select * from finish();
rollback;
