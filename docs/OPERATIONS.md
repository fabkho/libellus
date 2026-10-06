# Operations

Looking after the running app: what to read where, when something went wrong on a member's device, and
the nightly backup of the database.

## Client errors

Server-side errors are in the Supabase dashboard's logs. What goes wrong in the browser is kept in the
database's own small log, no third-party service:

| Kind | What it is | Reported by |
|---|---|---|
| `error` | an exception nothing caught (`window` `error`) | `web/app/plugins/error-log.client.ts` |
| `unhandledrejection` | a promise that failed and nobody asked | the same |
| `vue` | an error in a component or while the app starts (Nuxt's `vue:error`, `app:error`) | the same |
| `chunk` | a chunk of the build that could not be loaded, usually after a deploy (`app:chunkError`, or any error saying so) | the same |
| `outbox` | a write that waited offline and was refused when it synced: `<action> refused: <code>` | `web/app/stores/sync.ts` |
| `shelf` | the owner's shelf: the library file could not be fetched or read (`library file unreachable` / `invalid`), or Regal could not show it (`Regal: …`) | `web/app/stores/shelf.ts`, `web/app/components/shelf/` |

How it works: `web/app/data/errorLog.ts` keeps a short line of reports on the device (in memory and in
`localStorage`, so a reload after a missing chunk keeps it), folds the same error into one report with a
count, leaves out noise (the ResizeObserver loop, cancelled requests, no connection, browser extensions)
and sends the line a few seconds after the last report while there is a connection, through
`log_client_error` (`supabase/migrations/20261006073000_client_errors.sql`). Nothing reports the error
log's own failures. A build sends; `NUXT_PUBLIC_ERROR_LOG=off` stops it. The dev server prints every
report to the console and sends only with `NUXT_PUBLIC_ERROR_LOG=send`, or in the browser with
`localStorage['libellus-dev:error-log'] = 'send'`; `window.__libellusErrors.trigger('<kind>')` makes an
error of a kind on purpose (development only).

What a row holds, `private.client_errors`: the kind, the message (≤ 1 kB) and the stack (≤ 8 kB), both
without e-mail addresses, tokens or the query and fragment of any URL; the route's path, never its query;
the build (`app_version`, Nuxt's build id, `dev` on the dev server); the browser in a few words
(`user_agent`, "iOS 18.2 Safari 18.2"); whether the app ran installed (`standalone`) and online; how
often it happened (`count`, `created_at` to `last_seen_at`); and the member (`user_id`, null when signed
out). No book titles, notes or search terms. Signed-out devices can report too (the sign-in screens, a
deploy's missing chunks), keyed by a salted hash of their address, never the address.

Limits, enforced by the database: the same error within 10 minutes of its row's first report is counted
on that row; a member adds at most 30 rows an hour, one signed-out address 10, all signed-out devices
together 100; the rest is dropped quietly. Members can neither read nor delete the rows (the table is in
the schema `private`, which the API does not expose). Rows are deleted after 30 days by pg_cron's
`purge-client-errors` (daily, 03:45 UTC); a member's rows go with her account.

### Reading them

**In the app, as the owner:** Profile → Account → **Errors** (the row shows how many error groups first
appeared in the last 24 hours). It opens the last 7 days grouped by kind and message, newest first: a
chip with the kind, ×times, the message, when it was last seen and in which build and route; a filter by
kind; **Refresh** in the top bar. A tap opens the group's latest stack (mono, scrollable, **Copy** puts
the message, where it happened and the stack on the clipboard) and its figures: first and last seen, how
many members met it (a number, never who), the builds and routes, installed or in a tab, online or
offline. Only the instance's owner has it: the database answers `owner_client_errors(p_days)` and
`owner_client_error_detail(p_message_hash)` (`supabase/migrations/20261007100000_owner_client_errors.sql`)
only to the member named in `private.instance_owner` and raises `not_owner` for anyone else, signed-out
callers cannot call them at all, and the app shows the row and the page only for the member named by
`NUXT_PUBLIC_SHELF_OWNER_ID` and asks for nothing otherwise. Both have to name the owner: see
[SELF_HOSTING.md, The owner](SELF_HOSTING.md#the-owner). A member who is not the owner has no row, the
address `/profile/errors` is a 404, and a call to the functions is refused. The functions give the 30 days
the log keeps at most (`p_days`, 1 to 30, the app asks for 7) and at most 200 groups.

**In the dashboard's SQL editor** (it runs as the owner of the schema; for anything the app does not show) (it runs as the owner of the schema). The last 7 days, grouped by what
happened and in which build:

```sql
select kind,
       message,
       app_version,
       sum(count)                  as times,
       count(distinct user_id)     as members,
       count(*) filter (where user_id is null) as signed_out_rows,
       min(created_at)             as first_seen,
       max(last_seen_at)           as last_seen,
       array_agg(distinct route)   as routes,
       array_agg(distinct user_agent) as browsers
  from private.client_errors
 where created_at > now() - interval '7 days'
 group by kind, message, app_version
 order by last_seen desc;
```

One error's stacks, newest first:

```sql
select created_at, last_seen_at, count, route, app_version, user_agent, standalone, online, stack
  from private.client_errors
 where message = '<the message>'
 order by created_at desc
 limit 20;
```

Whose they were (only when it matters for a fix):

```sql
select e.created_at, e.kind, e.message, u.email
  from private.client_errors e
  join auth.users u on u.id = e.user_id
 where e.created_at > now() - interval '7 days'
 order by e.created_at desc;
```

Locally the same queries run against the local stack (`docker exec -it supabase_db_libellus psql -U
postgres`, or Studio at http://127.0.0.1:55323).

## Backups

The hosted Supabase project is on the Free plan, which keeps no backup anyone can download. So
`.github/workflows/backup.yml` makes one every night at 02:30 UTC (and on demand: Actions →
Database backup → Run workflow):

1. `scripts/backup-db.sh` runs `pg_dump` (custom format, the client of the server's own major version,
   installed from the PGDG apt repository) through the Supavisor **session pooler** (GitHub's runners have
   no IPv6, and on the Free plan the direct database address has nothing else), and streams the dump straight into `age`, encrypted to the
   owner's public key. The plaintext never touches the disk, the log or an artifact.
2. A copy of the same stream goes to `pg_restore --list`, which reads only the archive's table of contents:
   the job fails when the data of any table the database has in the backed-up schemas is missing, or when
   the encrypted file is smaller than `BACKUP_MIN_BYTES` (50 kB unless the variable says otherwise).
3. The file goes to the private R2 bucket `libellus-backups` as
   `db/YYYY/MM/DD/libellus-<YYYYMMDDTHHMMSSZ>.dump.age`; the job then compares the object's size in R2 with
   the file's. A lifecycle rule deletes objects under `db/` after 35 days: a month of nightly backups.

A failed run is mailed by GitHub to whoever last changed the workflow's schedule. Each successful run names
its object in the run's summary. GitHub switches scheduled workflows off in a public repository after 60
days without a commit (and mails before it does): Actions → Database backup → Enable workflow brings it back.

### What is in a backup, and what is not

| In it | Not in it |
| --- | --- |
| `public`: every Library, Book, Reading session, Collection, reader place and highlight (the member's own selected words, #131), invite code, Goodreads cache, … (schema and data) | Storage objects: the members' profile photos in the bucket `avatars` (#156; Covers are links, not files). See below |
| `private`: the error log, the shelf's publish state, the error log's salt | Vault secrets (`github_dispatch_token`): encrypted with the project's own key, useless anywhere else |
| `auth.users` and `auth.identities`: the members and their sign-in records, with their ids, so every row that names a member still does | Sign-in sessions, refresh tokens, one-time codes, MFA challenges, the auth audit log: they belong to the project they came from (members sign in again) |
| The rest of `auth`'s data (MFA factors, SSO, OAuth clients; all empty here) and its schema, restored only by `--mode full` | Auth settings, SMTP, email templates (dashboard; docs/SELF_HOSTING.md) |
| `supabase_migrations.schema_migrations`: which migrations the data belongs to | Edge functions and their secrets (`supabase/functions/`, `supabase secrets set`) |
| | `pg_cron` jobs and `pg_net`'s queue: the migrations schedule the jobs again |

**Profile photos are not in the backup.** They live in Supabase Storage (the private bucket `avatars`,
created by `supabase/migrations/20261009120000_avatars.sql`), and a database dump holds only the rows
that describe Storage's files, never the files themselves; the backup leaves the `storage` schema out
altogether. Copying the files too would need the project's S3 credentials (Storage's S3 protocol) in
the workflow and a second upload to R2, for photos a member can take again in seconds, so the nightly
job does not. After a restore every account still names its photo (`accounts.avatar_path`) while the
new project's bucket is empty: the app finds the file missing and shows the initials (devices that kept
the photo show it until their next start online), and a member who wants it back picks it again. To
keep the photos of a project you are leaving, download the bucket first with the CLI linked to the
old project (`supabase storage cp -r ss:///avatars ./avatars --linked --experimental`) and copy the
folders back into the new project's `avatars` bucket the same way; the paths stay the same, so the
restored accounts find their photos again.

The reader's highlights (`public.reader_highlights`, #131) are in the nightly backup like the rest of
`public`, and so are their words: a member's own selected sentences (at most 1000 characters each), kept
so a second device shows them. The backup is encrypted to the owner's key before it leaves the runner,
and a removed highlight is an empty tombstone and a deleted account leaves none (the rows cascade), so
a later backup holds nothing of either; the 35 days of older ones still do, as they do for every other
row of a deleted account.

### Setting it up

Once, by the owner (a self-hosted instance the same way, with its own names):

1. **The age key.** `age-keygen -o libellus-backup.key` writes the key file. Its line
   `# public key: age1…` is the **recipient** (also `age-keygen -y libellus-backup.key`); the line
   `AGE-SECRET-KEY-1…` is the private key. Keep the whole file in the password manager (a secure note),
   then delete it from the disk. Without it no backup can be opened: there is no other copy.
2. **The bucket.** `npx wrangler r2 bucket create libellus-backups --location weur`, no public access, no
   custom domain, no `r2.dev` address. Then the retention:
   `npx wrangler r2 bucket lifecycle add libellus-backups expire-db-backups db/ --expire-days 35 --abort-multipart-days 1`.
   Worth adding too, so that a leaked upload token cannot delete or overwrite a recent backup:
   `npx wrangler r2 bucket lock add libellus-backups keep-db-backups db/ --retention-days 30`.
3. **The token.** R2 → Manage API tokens → Create API token: permission **Object Read & Write**, applied to
   the bucket `libellus-backups` only, no expiry (or one you note down). It gives an Access Key ID and a
   Secret Access Key.
4. **The repository** (Settings → Secrets and variables → Actions):
   - secrets `SUPABASE_DB_URL` (the session pooler's connection string: Supabase → Connect → Session pooler,
     `postgresql://postgres.<ref>:<password>@aws-…-<region>.pooler.supabase.com:5432/postgres`),
     `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`;
   - variables `BACKUP_AGE_RECIPIENT` (the `age1…` line), `CLOUDFLARE_ACCOUNT_ID`; optional
     `BACKUP_R2_BUCKET` (default `libellus-backups`), `BACKUP_MIN_BYTES` (default `50000`).

   Without `BACKUP_AGE_RECIPIENT` the job is skipped; with it but a secret missing it fails and says which.
5. **The first run.** Actions → Database backup → Run workflow (or `gh workflow run backup.yml`), then
   `gh run watch`. Green, with the object's name in the summary, and the object in the bucket
   (`npx wrangler r2 object get libellus-backups/<key> --remote --file <key's file name>`, or the
   dashboard). Then try the key on it once: the restore below with `--dry-run`, or into a local scratch
   database.

### Restoring

`scripts/restore-backup.sh` downloads (or takes a downloaded file), decrypts with the private key into a
private temporary folder that it removes on exit, checks the target and restores in **one transaction**:
when anything fails, the target is as it was. It needs `age` and `pg_restore`/`psql` of the backup's
Postgres version or newer (`brew install age libpq` on a Mac, then put `$(brew --prefix libpq)/bin` on
`PATH`). It refuses the production project (`ltedflcewdcqtqzcjeyr`, or `LIBELLUS_PRODUCTION_REF`) and any
target that already has members, unless `--i-know` is passed; then the rows of every table the backup
covers are replaced.

The private key goes into a file only for the restore: paste it from the password manager into
`~/libellus-backup.key` (`chmod 600`), delete the file afterwards. Backups straight from R2 (`r2:latest`
or `r2:db/…`) need the aws CLI and a token that can read the bucket:
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `CLOUDFLARE_ACCOUNT_ID` in the environment. Or download the
object from the dashboard and pass the file.

**Into a fresh Supabase project** (the hosted one is gone or broken):

1. Create the project (region `eu-central-1`) and set it up as docs/SELF_HOSTING.md step 1 says: link, Auth
   settings, email templates, SMTP (step 2). `supabase db push` from a checkout that has at least the
   backup's migrations: the restore says which migration the backup ends with and refuses a target that
   lacks any of them. The push also brings back the `pg_cron` jobs.
2. Check, then restore, with the new project's session pooler string:

   ```sh
   export RESTORE_DATABASE_URL='postgresql://postgres.<new ref>:<password>@aws-…-eu-central-1.pooler.supabase.com:5432/postgres'
   scripts/restore-backup.sh --identity ~/libellus-backup.key --dry-run r2:latest
   scripts/restore-backup.sh --identity ~/libellus-backup.key r2:latest
   ```

   It restores the data of `public`, `private`, `auth.users` and `auth.identities` with triggers and
   foreign-key checks off for the session (`session_replication_role = replica`, which Supabase allows
   the `postgres` role): the sign-up trigger does not run again for restored members, and the rows a fresh
   project's migrations seed (the shelf's publish state, the error log's salt) are replaced by the
   backup's. It ends with the rows per table.
3. Set up what a backup does not hold: the Vault secret `github_dispatch_token` (docs/OWNER.md), the edge
   functions and their secrets (`supabase functions deploy goodreads-rating regal-export`, `supabase secrets set …`).
4. Point everything at the new project: the Pages project's `NUXT_PUBLIC_SUPABASE_URL` and
   `NUXT_PUBLIC_SUPABASE_ANON_KEY`, then retry the production deployment (docs/HOSTING.md); this
   repository's `SUPABASE_DB_URL`; whatever names the old project in docs/OWNER.md (Regal's workflow).
   Member ids are the same, so `NUXT_PUBLIC_SHELF_OWNER_ID` stays.
5. Members sign in again with a code: sessions are not restored, and the new project signs with its own keys.

**To read a backup** without touching any project: `--mode full` restores schema and data into an empty
database, e.g. a scratch database on the local stack (on Postgres without Supabase the policies' roles are
missing):

```sh
docker exec supabase_db_libellus psql -U postgres -c 'create database libellus_backup'
scripts/restore-backup.sh --identity ~/libellus-backup.key --mode full \
  --target postgresql://postgres:postgres@127.0.0.1:55322/libellus_backup ~/Downloads/libellus-….dump.age
# …read it, then:
docker exec supabase_db_libellus psql -U postgres -c 'drop database libellus_backup'
```

**The chain is tested**: `scripts/test-backup-roundtrip.sh` dumps the local stack with a throwaway key,
restores into a scratch database both ways (`--mode full`, and `--mode data` into a database shaped like a
freshly pushed project) and compares the rows table by table, then checks the guards. CI runs it after
Vitest on every change to the schema or these scripts (docs/TESTING.md).

## Supabase advisors: what we accept and why

The dashboard's Security Advisor (also `get_advisors` over MCP, or `supabase db advisors`) lists a
few findings on purpose. They are decisions, not oversights: do not "fix" them without changing the
decision first. Everything else it reports is a real finding and gets fixed (as the unindexed foreign
key, `citext` in `public` and the open trigger functions were, `supabase/tests/lints_test.sql` and
`trigger_functions_test.sql` keep those fixed).

| Finding | Where | Why it stays |
|---|---|---|
| `authenticated_security_definer_function_executable` (0029) | every RPC in `public`: `add_to_library`, `start_reading`, `finish_reading`, `sync_write`, `set_avatar`, `delete_my_account`, … | Members never write a table directly: every change is one RPC (`web/AGENTS.md`, Architecture), the tables grant members `select` at most, and the RPC is the only way in. It runs as its owner so it can write what the member may not touch herself (the shared Catalogue, the derived Status, the record of synced writes), and it checks everything on its own: the member is `auth.uid()`, never an argument, every row it touches is hers, and its `search_path` is pinned. Switching them to `SECURITY INVOKER` would mean opening the tables to direct writes. |
| `anon_security_definer_function_executable` (0028) | `invite_code_status(text)` | The sign-up screen checks the invite code before anyone has an account, so the caller is signed out by definition. It answers `valid`, `missing`, `invalid`, `expired` or `exhausted` for one code and reveals nothing else; `invite_codes` itself stays closed to the API (RLS on, no policy). |
| `authenticated_security_definer_function_executable` (0029) | `owner_client_errors(integer)`, `owner_client_error_detail(text)` | The owner reads the error log in the app (Client errors, above). Not granted to `anon`; a signed-in member who is not named in `private.instance_owner` gets `not_owner` (42501) from the first line of the function, before any row is read, so executability by `authenticated` opens nothing. They return groups and counts, never another member's id. |
| the same (0028) | `log_client_error(…)` | The error log (Client errors, above) has to hear from devices that are signed out: the sign-in screens, a deploy's missing chunks. It only appends to `private.client_errors`, scrubs what it is given, and limits signed-out reports harder (per salted address and in total). |
| `rls_enabled_no_policy` (0008, INFO) | `public.invite_codes`, `public.synced_writes`, `private.client_errors`, `private.client_error_salt`, `private.instance_owner` | RLS on with no policy is "nobody reads or writes this through the API". Only the security-definer functions above use these tables. A policy here would open them. |
| `auth_leaked_password_protection` | Auth | Members sign in with a code sent by e-mail (OTP); nobody has a password, so there is nothing to check against HaveIBeenPwned. |
| `auth_insufficient_mfa_options` | Auth | The same: the e-mail code is the only factor and there is no password to put a second factor behind. Revisit if passwords ever come. |

`extension_in_public` (0014) is not on this list: no extension lives in `public`. pg_net was moved
to `extensions` by `supabase/migrations/20261006094800_pg_net_extensions_schema.sql` (it is not
relocatable, so it was dropped and created again there; its functions stay in the schema `net`), and
`lints_test.sql` fails if an extension lands in `public` again. Enable a new extension with
`create extension … schema extensions`.
