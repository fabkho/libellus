-- pg_net leaves `public` (Supabase security advisor 0014, extension_in_public).
--
-- 20261005114229_shelf_publish_dispatch.sql enabled pg_net with a plain
-- `create extension pg_net`, which registers an extension in the first schema
-- of the search_path: `public`. Its objects never lived there (pg_net creates
-- and uses its own schema `net`: net.http_post, net.http_request_queue,
-- net._http_response), but the extension itself is registered in `public`, and
-- that is what the advisor flags. It moves to `extensions`, where the other
-- extensions are (citext moved in 20261005094847_lints_invite_index_citext_schema.sql).
--
-- pg_net is not relocatable (`alter extension … set schema` is refused), so it
-- is dropped and created again in `extensions`, as Supabase documents it:
--
--   * Dropping it drops the schema `net` with its queue and the responses kept
--     in net._http_response. A request still queued then is lost: a shelf
--     dispatch lost that way is made good by Regal's daily run or the owner's
--     next change, and private.shelf_publish.last_request_id simply names a
--     response that is no longer kept.
--   * Nothing else depends on the extension: the shelf's functions call
--     net.http_post through dynamic SQL by its schema-qualified name (`net`
--     does not move), so they keep working unchanged. The drop is not CASCADE:
--     should anything depend on pg_net after all, it fails instead of taking
--     that with it.
--   * Supabase's event trigger issue_pg_net_access grants `net` again on the
--     new extension (usage, and execute on net.http_get/http_post for the API
--     roles and supabase_functions_admin), as it did when pg_net was first
--     enabled.
--
-- Idempotent: where pg_net is already in `extensions` nothing happens; where it
-- is not installed but available (a stack whose earlier migration could not
-- enable it) it is enabled in `extensions`, or skipped with a notice as before.

create schema if not exists extensions;

do $$
declare
  v_schema text := (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_net');
begin
  if v_schema = 'extensions' then
    return;
  elsif v_schema is not null then
    drop extension pg_net;
    create extension pg_net schema extensions;
  elsif exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension pg_net schema extensions;
    exception when others then
      raise notice 'pg_net could not be enabled (%): the shelf is published daily only', sqlerrm;
    end;
  end if;
end;
$$;
