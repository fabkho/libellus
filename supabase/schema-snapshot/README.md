# Schema snapshot

**Generated. Read-only. Never edit a file here.** The current definition of every database object
(functions in `public` and `private`, tables, policies, triggers, views, grants, pg_cron jobs, the realtime
publication), one file per object, so "what is `add_entry` today" is one file, not the newest of 98 migrations.
The migrations in `supabase/migrations/` stay the source of truth; this folder is what they add up to.

| Path | Content |
| --- | --- |
| `functions/<schema>.<name>(<arg types>).sql` | `pg_get_functiondef`, one file per overload |
| `tables/<schema>.<table>.sql` | columns, constraints, indexes, RLS on/off, grants |
| `policies/<schema>.<table>.sql` | all RLS policies of a table (`public`, `private` and `storage`) |
| `triggers/<schema>.<table>.sql` | all triggers of a table (ours on `auth.users` and `storage.objects` too) |
| `views/` | views and materialized views |
| `types/` | enums |
| `grants/` | schema, table, function, sequence and default privileges for anon, authenticated, service_role, public |
| `cron/jobs.sql` | pg_cron jobs: name, schedule, command |
| `realtime/publication.sql` | realtime publications and their tables |
| `extensions.sql` | installed extensions |

Left out on purpose: `auth`, `storage` (except its policies and our triggers on it), `realtime`,
`extensions`, `graphql_public` and the other platform schemas; versions, OIDs, timestamps and data.

## Regenerate

After any migration, with the local stack up and migrated (`supabase start` or `supabase db reset`):

```sh
pnpm schema:snapshot   # from web/; or: node scripts/schema-snapshot/run.mjs
```

Commit the result with the migration. The PR check (`ci.yml`, `backend`, after `supabase test db`) fails with
`git diff --exit-code supabase/schema-snapshot` when it is stale. The release (`release.yml`, `deploy`) runs the
same query read-only against production and warns (never fails) when production differs from this folder, e.g. a
dashboard change that never became a migration.

The query is `scripts/schema-snapshot/snapshot.sql`; `run.mjs` writes the files. The database is the container of
the `project_id` in `$SUPABASE_WORKDIR/supabase/config.toml` (default: this repo's, `libellus`), or
`$SNAPSHOT_DB_CONTAINER`.
