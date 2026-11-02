# Buddy read: paste-ready specs

One file per pull request that can start now. Paste the whole file as the dispatch spec. Each says: title, repo and branch, tier, what to change, what is **not** in it, constraints, who owns which files, the tests and where they run, the docs, and the observable acceptance.
The plan they come from is [`../buddy-read-shared.md`](../buddy-read-shared.md); its part 4 (data model), part 5 (position design) and part 6 (the promise) are the reference. Where a spec and the plan disagree, the spec is the later word.

| File | PR | Repo | Tier |
|---|---|---|---|
| [`D1-database-rooms.md`](D1-database-rooms.md) | D1 | libellus | Opus |
| [`S1-trappist-layer-names.md`](S1-trappist-layer-names.md) | S1 | trappist (draft PR) | normal |
| [`W1-profile-switch.md`](W1-profile-switch.md) | W1 | libellus | normal |
| [`P1-progress-promise.md`](P1-progress-promise.md) | P1 | libellus | normal |

Every later PR (D2–D4, S2–S6, W2–W5, K1, X1–X3) has its scope in part 3 of the plan; the coordinator writes its spec from that paragraph when its dependency lands.
