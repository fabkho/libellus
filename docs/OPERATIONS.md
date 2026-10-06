# Operations

Looking after the running app: what to read where, when something went wrong on a member's device.

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

In the dashboard's SQL editor (it runs as the owner of the schema). The last 7 days, grouped by what
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
