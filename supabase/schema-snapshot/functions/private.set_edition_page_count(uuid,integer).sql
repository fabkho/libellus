CREATE OR REPLACE FUNCTION private.set_edition_page_count(p_book uuid, p_page_count integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_written integer;
begin
  if p_page_count is null or p_page_count not between 1 and 99999 then
    raise exception 'page_count_invalid' using errcode = '22023';
  end if;
  if p_book is null then
    return false;
  end if;
  update public.books
     set page_count = p_page_count
   where id = p_book and page_count is null;
  get diagnostics v_written = row_count;
  return v_written > 0;
end;
$function$
;
