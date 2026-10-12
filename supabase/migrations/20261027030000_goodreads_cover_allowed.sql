-- The Catalogue's one cover allow-list (`private.cover_allowed`, 20261022010000) learns Goodreads' image
-- host, `i.gr-assets.com`, for the import's last-resort cover source (docs/covers.md, "Goodreads, the
-- last resort"). The cover is only linked, never copied; if Goodreads objects, the host comes off this
-- list again and the Books show the cloth cover (the address stays in `books.cover_url`, and
-- `cover_shown` hides it on the social surfaces at once).
--
-- Same rule as before: https, the whole host exactly (no subdomains), followed by `/` or nothing, so
-- `host@evil`, `host:80@evil`, `host.evil` and `host#@evil` do not pass. Grants are kept by `create or replace`.
create or replace function private.cover_allowed(p_url text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(
    p_url ~* '^https://(covers\.openlibrary\.org|books\.fabkho\.dev|i\.gr-assets\.com|([a-z0-9-]+\.)+mzstatic\.com)(/|$)',
    false)
$$;
