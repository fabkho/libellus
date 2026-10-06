# Security

Please report a vulnerability **privately**, not in a public issue: use GitHub's
[private vulnerability reporting](https://github.com/fabkho/libellus/security/advisories/new)
(Security → Report a vulnerability). Say what you found, how to reproduce it and what it affects; you'll
hear back as soon as the owner has looked at it. Please give a fix the time it needs before you
publish anything.

In scope: this repository's code and its database rules (row-level security, the functions in
`supabase/migrations/`, the edge functions). A self-hosted instance's own configuration (its Supabase
project, keys, SMTP, hosting) is its operator's.

Please don't test against libellus.fabkho.dev or other people's data: a local stack
(docs/DEVELOPMENT.md) has everything the hosted one has.
