-- A Catalogue Book that entered without a cover can get one afterwards (the import's cover fill).
--
-- A Catalogue Book keeps the snapshot of the first member to add it (`catalogue_book_for`,
-- `import_book_for` return the row that is there and never rewrite it). A Book that landed without a cover
-- therefore stayed without one for every member after her, although a later import, or the import's own
-- background search for covers (web/app/data/coverFill.ts), may well find one.
--
-- `fill_book_covers(p_covers)` gives a Book a cover, and only that:
--   * the Book is a Catalogue Book (owner_id null) whose cover_url is null: a cover that is there is never
--     replaced (the check may, `catalogue_check_save`, from the source);
--   * the member holds it in her Library (an entry of hers), so a member cannot decorate Books she does not own;
--   * the cover is on the one allow-list (`private.cover_allowed`: Open Library's covers, Apple's artwork), the
--     thumbhash is base64 of at most 200 characters, the two colours are `#rrggbb`: anything else is left out
--     (the same Book without a cover, not an error: the import never fails for a cover).
-- A Book is named by its id (`book_id`), or by its ISBN-13 when the caller only has a snapshot (the Book the
-- import has just added). At most 200 covers a call. Returns how many Books got one.
create or replace function public.fill_book_covers(p_covers jsonb)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_item   jsonb;
  v_url    text;
  v_hash   text;
  v_dom    text;
  v_sec    text;
  v_id     uuid;
  v_done   integer := 0;
begin
  if v_member is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_covers is null or jsonb_typeof(p_covers) <> 'array' or jsonb_array_length(p_covers) > 200 then
    raise exception 'covers_invalid' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_covers) loop
    v_url  := nullif(btrim(v_item ->> 'cover_url'), '');
    v_hash := nullif(btrim(v_item ->> 'cover_thumbhash'), '');
    v_dom  := lower(nullif(btrim(v_item ->> 'cover_dominant'), ''));
    v_sec  := lower(nullif(btrim(v_item ->> 'cover_secondary'), ''));
    continue when v_url is null or char_length(v_url) > 500 or not private.cover_allowed(v_url);
    -- What describes the picture goes with it only when it is well formed; the cover itself does not need it.
    if v_hash is not null and (char_length(v_hash) > 200 or v_hash !~ '^[A-Za-z0-9+/=]+$') then v_hash := null; end if;
    if v_dom is not null and v_dom !~ '^#[0-9a-f]{6}$' then v_dom := null; end if;
    if v_sec is not null and v_sec !~ '^#[0-9a-f]{6}$' then v_sec := null; end if;
    if v_dom is null or v_sec is null then v_dom := null; v_sec := null; end if;

    v_id := null;
    if nullif(v_item ->> 'book_id', '') is not null then
      begin
        v_id := (v_item ->> 'book_id')::uuid;
      exception when invalid_text_representation then
        continue;
      end;
    elsif nullif(v_item ->> 'isbn13', '') is not null then
      select b.id into v_id from public.books b
       where b.owner_id is null and b.isbn13 = regexp_replace(v_item ->> 'isbn13', '[^0-9]', '', 'g');
    end if;
    continue when v_id is null;

    update public.books b
       set cover_url = v_url,
           cover_thumbhash = v_hash,
           cover_dominant = v_dom,
           cover_secondary = v_sec
     where b.id = v_id
       and b.owner_id is null
       and b.cover_url is null
       and exists (select 1 from public.library_entries e where e.book_id = b.id and e.member_id = v_member);
    if found then
      v_done := v_done + 1;
    end if;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.fill_book_covers(jsonb) from public, anon;
grant execute on function public.fill_book_covers(jsonb) to authenticated;
