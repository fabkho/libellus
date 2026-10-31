CREATE OR REPLACE FUNCTION public.reading_sessions_no_future_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  -- POSIX zone names count backwards: Etc/GMT-14 is UTC+14.
  v_latest_today date := (now() at time zone 'Etc/GMT-14')::date;
begin
  if new.started_on > v_latest_today or new.ended_on > v_latest_today then
    raise exception 'date_in_future' using errcode = '22023';
  end if;
  return new;
end;
$function$
;
