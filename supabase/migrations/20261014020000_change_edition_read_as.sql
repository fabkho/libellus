-- Change edition presets "Read as" from the new edition's format.
--
-- "Read as" (issue #169, library_entries.read_as) is how the member read the Book:
-- physical, ebook or audiobook; null while she has not said, and then the edition's
-- format is the default the client shows (`readAsOf`). Until now moving an entry to
-- another edition left it untouched, so a member who had said "physical" and then
-- changed to the ebook edition still read it "as paper".
--
-- Now the move (`move_entry_to`, which change_edition and use_own_edition both end in,
-- so one transaction with the move) presets it from the new edition's format, the
-- one that counts for the entry: the format she said for it, else its Book's.
--
--   hardcover, paperback -> physical;  ebook -> ebook;  audiobook -> audiobook
--
-- Rules:
--   * Only her own word is replaced. An entry whose read_as is null keeps null: the
--     new edition's format is its default already.
--   * Format unknown (the Book has none and she said none): read_as stays as it was.
--   * Her word is kept when the move does not change how the edition is read: she said
--     "audiobook" for a paperback and moves to another paperback, it is still hers.
--     Only when the new edition is read differently from the old one (paper to ebook,
--     an unknown format to anything) does the new edition's way replace it.
--
-- Nothing else changes: this replaces move_entry_to with the same signature.

-- How an edition of this format is read; null for none. Not callable by members.
create function public.read_as_for_format(p_format public.book_format)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case p_format
    when 'hardcover' then 'physical'
    when 'paperback' then 'physical'
    when 'ebook' then 'ebook'
    when 'audiobook' then 'audiobook'
  end
$$;

revoke all on function public.read_as_for_format(public.book_format) from public, anon, authenticated;

create or replace function public.move_entry_to(p_entry public.library_entries, p_book_id uuid, p_format public.book_format)
returns public.library_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry      public.library_entries := p_entry;
  v_old        public.books;
  v_new        public.books;
  v_read_as    text;
begin
  if exists (
    select 1 from public.library_entries
     where member_id = v_entry.member_id and book_id = p_book_id and id <> v_entry.id
  ) then
    raise exception 'edition_in_library' using errcode = '23505';
  end if;

  select * into v_old from public.books where id = v_entry.book_id;
  select * into v_new from public.books where id = p_book_id;

  -- What the new edition says about how it is read (her word on its format, else the
  -- Book's), when it is read differently from the edition the entry leaves.
  v_read_as := public.read_as_for_format(coalesce(p_format, v_new.format));
  if v_read_as is not distinct from public.read_as_for_format(coalesce(v_entry.format_override, v_old.format)) then
    v_read_as := null;
  end if;

  begin
    update public.library_entries
       set book_id = p_book_id,
           edition_changed_at = now(),
           format_override = case when p_format is distinct from v_new.format then p_format end,
           read_as = case when read_as is not null then coalesce(v_read_as, read_as) end
     where id = v_entry.id
    returning * into v_entry;
  exception when unique_violation then
    -- The same edition added on another device a moment ago.
    raise exception 'edition_in_library' using errcode = '23505';
  end;

  -- The member's own total (#60) when she set one, else the new edition's.
  perform public.clamp_session_progress(v_entry.id, coalesce(v_entry.page_count_override, v_new.page_count));

  -- Her Manual book, now used by nothing: gone, so her search never shows the stale copy.
  if v_old.owner_id = v_entry.member_id
     and not exists (select 1 from public.library_entries where book_id = v_old.id) then
    delete from public.books where id = v_old.id;
  end if;

  return v_entry;
end;
$$;

revoke all on function public.move_entry_to(public.library_entries, uuid, public.book_format)
  from public, anon, authenticated;

comment on column public.library_entries.read_as is
  'How the member read this Book: physical, ebook or audiobook; null = not set. Hers, not the edition''s: '
  'a word she never said stays null. Set through set_read_as; preset by move_entry_to (change_edition, '
  'use_own_edition) from the new edition''s format when she had a word and the edition is read another way.';
