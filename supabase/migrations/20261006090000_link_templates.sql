-- Book links (issue #116): a member's own short, ordered list of links that a
-- Book's page offers her, each a label and a URL template with placeholders the
-- client fills from the Book (`{isbn}`, `{isbn10}`, `{title}`, `{author}`,
-- URL-encoded; web/app/utils/linkTemplates.ts). The first is the page's link,
-- the rest wait behind More. A catalogue, a bookshop, a library: whatever she
-- wants one tap away. Nothing is looked up or checked; they are just links.
--
-- Hers alone: only she reads her row (RLS), and nobody writes it but
-- `set_link_templates`, which takes the whole list (in her order) and replaces
-- what was there. Unlike the instance-wide defaults an operator may build into
-- the app (NUXT_PUBLIC_LINK_TEMPLATES, public by nature), these never leave the
-- database for anyone else. Deleted with the member (auth.users cascades).
--
-- The shape, checked here and in `set_link_templates` alike:
--   [{ "label": "Open Library", "url": "https://openlibrary.org/isbn/{isbn}" }, …]
--   at most 20; exactly the keys label and url, both strings; the label 1–40
--   characters, the URL at most 2000, starting http:// or https:// with a host
--   that has no placeholder in it. Labels and URLs are stored trimmed.
--
-- Refusals: not_signed_in (42501), link_templates_invalid (22023).

create schema if not exists private;

create or replace function private.link_templates_valid(p_templates jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_item jsonb;
begin
  if p_templates is null or jsonb_typeof(p_templates) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_templates) > 20 then
    return false;
  end if;
  for v_item in select value from jsonb_array_elements(p_templates) loop
    if jsonb_typeof(v_item) <> 'object'
       or not (v_item ?& array['label', 'url'])
       or (select count(*) from jsonb_object_keys(v_item)) <> 2
       or jsonb_typeof(v_item -> 'label') <> 'string'
       or jsonb_typeof(v_item -> 'url') <> 'string' then
      return false;
    end if;
    if char_length(btrim(v_item ->> 'label')) not between 1 and 40
       or char_length(btrim(v_item ->> 'url')) > 2000
       or btrim(v_item ->> 'url') !~* '^https?://[^[:space:]/?#{}]+([/?#][^[:space:]]*)?$' then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

revoke all on function private.link_templates_valid(jsonb) from public, anon, authenticated;

create table public.link_templates (
  member_id  uuid primary key references auth.users on delete cascade,
  templates  jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint link_templates_valid check (private.link_templates_valid(templates))
);

comment on table public.link_templates is
  'Issue #116: a member''s own Book links, an ordered list of { label, url } templates. '
  'Private to her; written only through set_link_templates.';

alter table public.link_templates enable row level security;

-- Supabase grants a new table to the API roles; this one is read by its member
-- and written by the function below, nothing else.
revoke all on public.link_templates from anon, authenticated;
grant select on public.link_templates to authenticated;

create policy link_templates_select_own on public.link_templates
  for select to authenticated using (member_id = (select auth.uid()));

-- The member's whole list, in her order; an empty list clears it.
create or replace function public.set_link_templates(p_templates jsonb)
returns public.link_templates
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_member uuid := auth.uid();
  v_clean  jsonb;
  v_row    public.link_templates;
begin
  if v_member is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if not private.link_templates_valid(p_templates) then
    raise exception 'link_templates_invalid' using errcode = '22023';
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('label', btrim(item ->> 'label'), 'url', btrim(item ->> 'url')) order by position),
           '[]'::jsonb)
    into v_clean
    from jsonb_array_elements(p_templates) with ordinality as t(item, position);

  insert into public.link_templates as l (member_id, templates, updated_at)
  values (v_member, v_clean, now())
  on conflict (member_id) do update
    set templates = excluded.templates, updated_at = excluded.updated_at
  returning l.* into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_link_templates(jsonb) from public, anon;
grant execute on function public.set_link_templates(jsonb) to authenticated;
