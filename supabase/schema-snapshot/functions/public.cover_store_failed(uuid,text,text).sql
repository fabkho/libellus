CREATE OR REPLACE FUNCTION public.cover_store_failed(p_book uuid, p_runner text, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_found uuid;
begin
  if p_reason is null or p_reason not in ('throttled', 'deleting', 'gone', 'unsupported_url',
                                          'timeout', 'host_error', 'not_image', 'too_large', 'r2_error') then
    raise exception 'reason_invalid' using errcode = '22023';
  end if;

  if p_reason in ('throttled', 'deleting') then
    update private.cover_store_queue
       set state = 'queued', due_at = now() + interval '10 minutes', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  elsif p_reason = 'gone' then
    update private.cover_store_queue
       set state = 'gone', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  elsif p_reason = 'unsupported_url' then
    update private.cover_store_queue
       set state = 'unsupported', leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  else
    update private.cover_store_queue
       set attempts = attempts + 1,
           state = case when attempts + 1 > 5 then 'failed' else 'queued' end,
           due_at = now() + case attempts + 1
                              when 1 then interval '1 minute' when 2 then interval '10 minutes' when 3 then interval '1 hour'
                              when 4 then interval '6 hours' when 5 then interval '24 hours' else interval '7 days' end,
           leased_by = null, leased_until = null, last_error = p_reason
     where book_id = p_book and state = 'leased' and leased_by = p_runner
    returning book_id into v_found;
  end if;
  return v_found is not null;
end
$function$
;
