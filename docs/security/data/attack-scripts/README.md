# Attack scripts (security round, October 2026)

Throwaway scripts used for `docs/security/final-round-2026-10.md`, area 1 and 2. They act as real
signed-in members against **a local stack only** (never production): direct PostgREST, RPC and edge function
calls with the members' own access tokens.

```sh
# a local stack on free ports (copy supabase/ to /tmp, change the ports, own project id), then:
export LIBELLUS_API=http://127.0.0.1:55761
export LIBELLUS_ANON_KEY=...      # `supabase status` of that stack
export LIBELLUS_SERVICE_KEY=...   # same; local demo keys only
node setup.mjs                    # three throwaway members (ida, max, cleo) -> accts.json (tokens last one hour)
sed "s/<IDA_ID>/$(node -e "console.log(require('./accts.json').ida.id)")/" fixtures.sql | psql ...   # series fixtures for a_series
supabase functions serve          # for a_fn.mjs (goodreads-rating); it contacts Goodreads only for a lookup that passes validation
node a_search.mjs                 # etc.
```

`../attack-transcripts.txt` is the output of one run. `goodreads_isbn_poison_demo.ts` needs only Deno
(`deno run --allow-read goodreads_isbn_poison_demo.ts`): the real handler with a stubbed Goodreads and cache.
