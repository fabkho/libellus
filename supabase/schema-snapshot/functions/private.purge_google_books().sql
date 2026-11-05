CREATE OR REPLACE FUNCTION private.purge_google_books()
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_gone bigint;
begin
  -- An expired row is never answered; an hour's grace only keeps the purge out of the way of a lookup in flight.
  delete from public.google_books_cache where expires_at < now() - interval '1 hour';
  get diagnostics v_gone = row_count;
  -- A month of counters is plenty to see the day's use and the trend.
  delete from public.google_books_budget where day < (now() at time zone 'America/Los_Angeles')::date - 30;
  return v_gone;
end;
$function$
;
