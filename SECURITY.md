# Security

Please report a vulnerability **privately**, not in a public issue: use GitHub's
[private vulnerability reporting](https://github.com/fabkho/libellus/security/advisories/new)
(Security → Report a vulnerability). Say what you found, how to reproduce it and what it affects; you'll
hear back as soon as the owner has looked at it. Please give a fix the time it needs before you
publish anything. The same address is in the instance's
[security.txt](https://libellus.fabkho.dev/.well-known/security.txt). Only the latest release and `main` are
supported; there is no bug bounty.

In scope: this repository's code and its database rules (row-level security, the functions in
`supabase/migrations/`, the edge functions), and the configuration of the one instance (its Supabase
project, keys, SMTP, hosting), which the owner runs.

Please don't test against libellus.fabkho.dev or other people's data: a local stack
(docs/DEVELOPMENT.md) has everything the hosted one has.
