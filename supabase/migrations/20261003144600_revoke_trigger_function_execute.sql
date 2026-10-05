-- Trigger functions are not part of the API (issue #47).
--
-- PostgREST exposes every function in `public` that the API roles may execute
-- as `/rpc/<name>`. The functions below exist only to be fired by a trigger,
-- yet Supabase's default privileges (and PUBLIC's default EXECUTE) let `anon`
-- and `authenticated` call them; the security advisor flags the four that are
-- SECURITY DEFINER. Called over `/rpc` they fail ("trigger functions can only
-- be called as triggers"), but there is no reason for the endpoint to exist,
-- and a definer function should never be reachable by anonymous callers.
--
-- Revoking EXECUTE does not break the triggers: Postgres checks the privilege
-- when a trigger is *created*, not each time it fires, so the triggers keep
-- running for whoever writes the row (the tests in
-- supabase/tests/trigger_functions_test.sql fire each of them).
--
-- Every function returning `trigger` in `public` is listed; a new one gets its
-- own `revoke` in the migration that adds it.

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_confirmed() from public, anon, authenticated;
revoke all on function public.library_entries_derive_status() from public, anon, authenticated;
revoke all on function public.reading_sessions_update_status() from public, anon, authenticated;
revoke all on function public.reading_sessions_no_future_dates() from public, anon, authenticated;
revoke all on function public.collection_entries_same_member() from public, anon, authenticated;
