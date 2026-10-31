CREATE OR REPLACE FUNCTION public.add_to_collection(p_collection uuid, p_book jsonb)
 RETURNS library_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_collection public.collections := public.own_collection(p_collection);
  v_member     uuid := v_collection.member_id;
  v_book_id    uuid;
  v_isbn13     text;
  v_apple_id   text;
  v_ol_key     text;
  v_entry      public.library_entries;
begin
  if p_book is null or jsonb_typeof(p_book) <> 'object' then
    raise exception 'book_invalid' using errcode = '22023';
  end if;

  if p_book ? 'id' then
    -- A Book by its id: only one this member may see.
    begin
      v_book_id := (p_book ->> 'id')::uuid;
    exception when invalid_text_representation then
      raise exception 'book_invalid' using errcode = '22023';
    end;
    perform 1 from public.books
     where id = v_book_id and (owner_id is null or owner_id = v_member);
    if not found then
      raise exception 'book_invalid' using errcode = '22023';
    end if;
  else
    -- A snapshot: the Catalogue Book add_to_library would find, in its order
    -- (an ISBN-13 first, then a source id), normalised the same way.
    v_isbn13   := nullif(upper(regexp_replace(p_book ->> 'isbn13', '[^0-9Xx]', '', 'g')), '');
    v_apple_id := nullif(p_book ->> 'apple_id', '');
    v_ol_key   := nullif(p_book ->> 'openlibrary_edition_key', '');
    select id into v_book_id from public.books
     where owner_id is null and v_isbn13 is not null and isbn13 = v_isbn13;
    if v_book_id is null then
      select id into v_book_id from public.books
       where owner_id is null
         and ((v_apple_id is not null and apple_id = v_apple_id)
           or (v_ol_key is not null and openlibrary_edition_key = v_ol_key))
       limit 1;
    end if;
  end if;

  if v_book_id is not null then
    select * into v_entry from public.library_entries
     where member_id = v_member and book_id = v_book_id;
  end if;

  if v_entry.id is null then
    if v_book_id is not null then
      -- In the Catalogue (or hers), not in her Library: Want to read.
      insert into public.library_entries (member_id, book_id, status)
      values (v_member, v_book_id, 'want_to_read')
      on conflict (member_id, book_id) do nothing
      returning * into v_entry;
      if v_entry.id is null then
        -- A concurrent add of the same Book won; use its entry.
        select * into v_entry from public.library_entries
         where member_id = v_member and book_id = v_book_id;
      end if;
    else
      -- New to the Catalogue: add_to_library takes the snapshot in, with all its checks.
      begin
        v_entry := public.add_to_library(p_book => p_book);
      exception when sqlstate '23505' then
        -- Added under another key in between; its entry is there now.
        select e.* into v_entry from public.library_entries e
          join public.books b on b.id = e.book_id
         where e.member_id = v_member and b.owner_id is null
           and ((v_isbn13 is not null and b.isbn13 = v_isbn13)
             or (v_apple_id is not null and b.apple_id = v_apple_id)
             or (v_ol_key is not null and b.openlibrary_edition_key = v_ol_key))
         limit 1;
        if v_entry.id is null then
          raise;
        end if;
      end;
    end if;
  end if;

  begin
    insert into public.collection_entries (collection_id, entry_id, position)
    values (
      v_collection.id, v_entry.id,
      coalesce((select max(position) from public.collection_entries where collection_id = v_collection.id), 0) + 1
    );
  exception when unique_violation then
    raise exception 'already_in_collection' using errcode = '23505';
  end;

  return v_entry;
end;
$function$
;
