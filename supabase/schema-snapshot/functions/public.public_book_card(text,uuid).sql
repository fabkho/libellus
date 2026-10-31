CREATE OR REPLACE FUNCTION public.public_book_card(p_token text, p_book uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private', 'pg_temp'
AS $function$
declare
  v_page   public.reading_pages;
  v_entry  public.library_entries;
  v_book   public.books;
  v_ended  date;
  v_rating smallint;
  v_review text;
  v_spoilers boolean;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' or p_book is null then
    return null;
  end if;
  select * into v_page from public.reading_pages where token = p_token;
  if not found then
    return null;
  end if;
  select * into v_entry from public.library_entries where member_id = v_page.member_id and book_id = p_book and not hidden;
  if not found then
    return null;
  end if;
  if not exists (select 1 from public.reading_page_books where member_id = v_page.member_id and book_id = p_book)
     and p_book not in (select private.reading_page_shown_books(v_page)) then
    return null;
  end if;

  select * into v_book from public.books where id = p_book;
  select r.ended_on, r.rating, r.review,
         (select s.review_spoilers from public.reading_sessions s where s.id = r.session_id)
    into v_ended, v_rating, v_review, v_spoilers
    from private.reading_page_reads(v_page.member_id) r
   where r.book_id = p_book
   order by r.ended_on desc nulls last, r.created_at desc
   limit 1;

  return jsonb_build_object(
    'name', private.reading_page_name(v_page.member_id),
    'book', private.reading_page_book_json(v_book),
    'status', v_entry.status,
    'ended_on', v_ended,
    'rating', v_rating,
    'review', private.reading_page_review(v_page.member_id, p_book, v_review),
    'spoilers', coalesce(private.reading_page_review(v_page.member_id, p_book, v_review) is not null
                         and v_spoilers, false),
    'folded', coalesce(private.reading_page_review(v_page.member_id, p_book, v_review) is not null
                       and private.review_folded(auth.uid(), v_page.member_id, p_book, v_spoilers), false));
end;
$function$
;
