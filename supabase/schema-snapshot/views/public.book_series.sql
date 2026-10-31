create view public.book_series with (security_invoker=true) as
 SELECT bw.book_id,
    ws.series_id,
    ws."position",
    ws.source
   FROM book_works bw
     JOIN work_series ws ON ws.work_id = bw.work_id;

-- grants (anon, authenticated, service_role, public)
grant delete on table public.book_series to service_role;
grant insert on table public.book_series to service_role;
grant maintain on table public.book_series to service_role;
grant references on table public.book_series to service_role;
grant select on table public.book_series to authenticated;
grant select on table public.book_series to service_role;
grant trigger on table public.book_series to service_role;
grant truncate on table public.book_series to service_role;
grant update on table public.book_series to service_role;
