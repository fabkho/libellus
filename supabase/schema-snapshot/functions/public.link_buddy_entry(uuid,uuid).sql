CREATE OR REPLACE FUNCTION public.link_buddy_entry(p_id uuid, p_entry uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_caller uuid := auth.uid();
  v_me     public.buddy_read_members;
begin
  if v_caller is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  perform private.buddy_gate(p_id, v_caller);
  -- Her entry first (an entry that is not hers or not there is refused below, as before).
  if p_entry is not null then
    perform 1 from public.library_entries where id = p_entry and member_id = v_caller for no key update;
  end if;
  perform private.buddy_lock_read(p_id);
  perform private.buddy_gate(p_id, v_caller);
  if (select status from public.buddy_reads where id = p_id) = 'archived' then
    raise exception 'buddy_read_archived' using errcode = 'PT409';
  end if;

  if p_entry is not null and not exists (
    select 1
      from public.library_entries e
      join public.books eb on eb.id = e.book_id
      join public.buddy_reads r on r.id = p_id
      join public.books rb on rb.id = r.book_id
     where e.id = p_entry and e.member_id = v_caller
       and (eb.id = rb.id
            or (rb.openlibrary_work_key is not null and eb.openlibrary_work_key = rb.openlibrary_work_key
                and not eb.check_failed and not rb.check_failed))
  ) then
    raise exception 'buddy_entry_invalid' using errcode = '22023';
  end if;

  update public.buddy_read_members set entry_id = p_entry
   where buddy_read_id = p_id and member_id = v_caller
  returning * into v_me;
  return private.buddy_me(v_me, private.buddy_parts(p_id));
end;
$function$
;
