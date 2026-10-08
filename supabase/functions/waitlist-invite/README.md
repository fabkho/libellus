# waitlist-invite

The owner's **Invite** button on her Waitlist screen (issue #171, Profile → Account → Waitlist):
one tap gets a one-use invite code for the entry, mails it to the address with the sign-up link,
marks the entry invited and shows the owner the code, so she can also send it another way.

```
POST /functions/v1/waitlist-invite        { "id": "<waitlist entry uuid>" }
Authorization: Bearer <the owner's access token>   (the app's functions.invoke sends it)

200 { code, expiresAt, emailed: true }                               mailed, entry marked invited
200 { code, expiresAt, emailed: false, reason: "not_configured" }    no SMTP secrets: nothing sent
200 { code, expiresAt, emailed: false, reason: "send_failed" }       the SMTP server refused or was away
200 { code, expiresAt, emailed: true, invited: false }               mailed, the marking failed (the app marks it)
400 bad_request · 401 unauthorized · 403 not_owner · 404 not_found · 405 · 502 database_failed
```

## How it answers (`handler.ts`)

1. `verify_jwt` is on (`supabase/config.toml`): only a signed-in member's request reaches it.
2. It asks `public.owner_waitlist_prepare_invite(id)` **with the caller's own Authorization header**
   (index.ts builds the Supabase client with it and the anon key; there is no service-role key in
   the function). The database decides: anyone but the instance's owner gets `not_owner` (403).
   The answer is the address and a one-use code valid 14 days: the entry's own code while it is
   unused and unexpired, otherwise a new one (label `waitlist`, never the address).
3. It sends the mail (`mail.ts`: short plain text and a minimal HTML twin, no tracking pixel, no
   remote image, no unsubscribe link: a one-off transactional mail she asked for; the wording she
   agreed to, consent text `2026-10`, says the address is only used "to send you an invite").
4. Only after the mail went out does it call `owner_waitlist_set_invited([id], true)`.

Without the SMTP secrets, or when the send fails, the entry stays **waiting** and the code still
comes back, so the owner can copy it and send it herself; her next Invite gets the **same** code.
No log line carries the address or the code: a failed send logs its kind only (`smtp 550`,
`ECONNECTION`).

## Configuration (function secrets)

| Secret | Required | What |
| --- | --- | --- |
| `SMTP_HOST` | yes | Your mail service's SMTP host, e.g. `smtp.example.com` |
| `SMTP_PORT` | yes | `465` (implicit TLS) or the provider's alternative port, e.g. `2465`/`2587`. Hosted Supabase blocks outgoing 25 and 587. Any port but 465/2465 upgrades with STARTTLS. |
| `SMTP_USER`, `SMTP_PASS` | yes | The SMTP credentials |
| `SMTP_FROM` | yes | The sender address, e.g. `invites@example.com` (a domain the service may send for) |
| `SMTP_FROM_NAME` | no | The sender's name, e.g. `Libellus` |
| `LIBELLUS_SITE_URL` | no | Your app's address; the mail links to `<it>/sign-up`. Unset: the mail says to open Libellus and choose Sign up with a code. |

Any of the five required ones missing counts as "mail not configured": the Invite button still
mints and shows the code. The SMTP client is nodemailer, pinned in `deno.json`, behind the
`Mailer` interface (`smtp.ts`), so the tests inject a fake and never load it.

## Local

```sh
cd supabase/functions/waitlist-invite && deno task test   # unit tests, offline
```

To send through the local mailbox (Mailpit, http://127.0.0.1:55324), serve it with an env file.
The edge runtime does not resolve the Mailpit container's name, so give its address:

```sh
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' supabase_inbucket_libellus
cat > /tmp/waitlist-invite.env <<'EOF'
SMTP_HOST=<that address>
SMTP_PORT=1025
SMTP_USER=local
SMTP_PASS=local
SMTP_FROM=invites@libellus.local
LIBELLUS_SITE_URL=http://localhost:3020
EOF
supabase functions serve waitlist-invite --env-file /tmp/waitlist-invite.env   # from the repo root
```

Then Invite on the owner's Waitlist screen (the owner is the member `NUXT_PUBLIC_SHELF_OWNER_ID`
names and `private.instance_owner` holds) and read the mail in Mailpit.

## Deploy (hosted)

```sh
supabase functions deploy waitlist-invite
supabase secrets set SMTP_HOST=<smtp host> SMTP_PORT=465 SMTP_USER=<user> SMTP_PASS=<password> \
  SMTP_FROM=<invites@your domain> SMTP_FROM_NAME=Libellus
supabase secrets set LIBELLUS_SITE_URL=https://<your address>   # optional: the link in the mail
```

It reads `verify_jwt = true` from `config.toml`. It needs the migration
`20261013010000_waitlist_invite.sql` (`owner_waitlist_prepare_invite`). Until it is deployed the
Invite button says the invite could not be made; Mark invited and Copy waiting emails work as before.
