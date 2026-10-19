-- `fill_book_covers` learns the import's one-time Apple upgrade (issue #366, docs/covers.md, "The Apple upgrade").
--
-- It still gives a Catalogue Book a cover when it has none, and only then, as before (20261027010000). A call may now
-- also say `replaces`: the cover address the caller saw on the Book (a small one, or a linked Goodreads one). The Book
-- then takes the new cover only if it still has exactly that cover (a compare-and-swap: a cover another member's
-- upgrade, the check or a later pick put there meanwhile is never overwritten, and a second run of the same upgrade
-- changes nothing), and only if the new cover is Apple's artwork (`mzstatic.com`, the larger cover the upgrade
-- is for). Everything else is as before: a Catalogue Book (owner_id null) the member holds in her Library, the one
-- allow-list, a malformed thumbhash or colour dropped, at most 200 a call, the count of Books changed returned. A Manual
-- book and the member's own pick of an edition are other Books or entries and are never reached by this.
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
  v_old    text;
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
    v_old  := nullif(btrim(v_item ->> 'replaces'), '');
    continue when v_url is null or char_length(v_url) > 500 or not private.cover_allowed(v_url);
    -- An upgrade (`replaces`: the cover the caller saw on the Book) is only ever Apple's artwork, the larger cover.
    continue when v_old is not null and v_url !~* '^https://([a-z0-9-]+\.)+mzstatic\.com(/|$)';
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
       -- No cover yet, or (an upgrade) exactly the one the caller replaces: a cover another member upgraded meanwhile stays.
       and (b.cover_url is null or (v_old is not null and b.cover_url = v_old))
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
