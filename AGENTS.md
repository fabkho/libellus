# Libellus — rules for agents

The web app's own rules are in `web/AGENTS.md`.

## Where documentation goes

- **README.md is for people who find the repository**: what Libellus is, what it does with your data (one line
  per service, the processor table), how to run it in short. Nothing else.
- **No setup, configuration or operator notes in the README**: no environment variables, secrets, DSNs, tokens,
  dashboards, workflow jobs, scrubber or watchdog details. They go to:
  - `docs/OPERATIONS.md`: running the instance (releases, monitoring, Sentry, backups, jobs, own covers);
  - `docs/HOSTING.md`: Cloudflare, domains, build environment;
  - `docs/SETUP.md`: setting up a new instance, every variable and secret;
  - `docs/THIRD-PARTY.md`: what each external service gets.
- A new service adds at most one row to the README's processor table and a sentence where a member would care;
  its details go to the files above, and the README points there.
- Plans go to `docs/plans/`, proposals to `docs/proposals/`, screen behaviour to `docs/parity.md`.

## The database

- **The migrations are the source of truth; `supabase/schema-snapshot/` is what they add up to.** The current
  definition of every object (functions in `public` and `private`, tables, policies, triggers, grants, cron
  jobs, the realtime publication) is one generated file there. After a migration, run `pnpm schema:snapshot`
  (from `web/`, local stack up and migrated) and commit the result with it; CI fails on a stale snapshot
  (`ci.yml`, docs/TESTING.md). Never edit a file in it by hand: it is generated, read-only.
- A rule change comes with a migration and pgTAP tests (`CONTRIBUTING.md`); never with a dashboard change.
  `release.yml` runs the same query read-only against production after the migrations and warns when the
  two differ, which is how a dashboard change that never landed in a migration is noticed.
- **An applied migration is never edited or deleted.** `supabase db push` records each file's version in
  `supabase_migrations.schema_migrations` and never reads the file again: an edit after the deploy changes only
  the local and CI stacks, production keeps the old definition, and the snapshot drifts from it for good. A wrong
  migration is corrected by the next one. `ci.yml` fails a pull request that does anything but add a file under
  `supabase/migrations/` (a tree comparison against the pull request's base commit, seconds, no stack).
