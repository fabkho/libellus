CREATE OR REPLACE FUNCTION public.cover_store_claim(p_runner text, p_limit integer DEFAULT 8)
 RETURNS TABLE(book_id uuid, source_url text, attempts integer, needs_thumbhash boolean, needs_colours boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
begin
  -- A Book no longer in any Library is dropped, and so is a row whose Book has its copy already (the reconcile can
  -- queue a Book just after cover_store_done committed).
  delete from private.cover_store_queue q
   where (q.state in ('queued', 'leased')
          and not exists (select 1 from public.library_entries e where e.book_id = q.book_id))
      or exists (select 1 from public.books b where b.id = q.book_id and b.cover_key is not null);

  update private.cover_store_queue q
     set attempts = q.attempts + 1,
         state = case when q.attempts + 1 > 5 then 'failed' else 'queued' end,
         due_at = case when q.attempts + 1 > 5 then now() + interval '7 days' else now() end,
         leased_by = null, leased_until = null, last_error = 'lease_expired'
   where q.state = 'leased' and q.leased_until < now();

  return query
    with picked as (
      select q.book_id
        from private.cover_store_queue q
       where q.state = 'queued' and q.due_at <= now()
       order by q.due_at, q.enqueued_at
       limit least(greatest(coalesce(p_limit, 8), 1), 20)
       for update skip locked
    ), leased as (
      update private.cover_store_queue q
         set state = 'leased', leased_by = p_runner, leased_until = now() + interval '170 seconds',
             source_url = b.cover_url
        from picked p
        join public.books b on b.id = p.book_id
       where q.book_id = p.book_id and b.cover_url is not null
      returning q.book_id, q.source_url, q.attempts, b.cover_thumbhash, b.cover_dominant, b.cover_secondary
    )
    select l.book_id, l.source_url, l.attempts, l.cover_thumbhash is null,
           (l.cover_dominant is null and l.cover_secondary is null)
      from leased l;
end
$function$
;
