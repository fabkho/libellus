# Buddy read: paste-ready specs

One file per pull request that can start now or next (D1, S1, W1 are built; their PRs are #473, Trappist #366, #472). Paste the whole file as the dispatch spec. Each says: title, repo and branch, tier, what to change, what is **not** in it, constraints, who owns which files, the tests and where they run, the docs, and the observable acceptance.
The plan they come from is [`../buddy-read-shared.md`](../buddy-read-shared.md); its part 4 (data model), part 5 (position design) and part 6 (the promise) are the reference. Where a spec and the plan disagree, the spec is the later word.

| File | PR | Repo | Tier |
|---|---|---|---|
| [`D1-database-rooms.md`](D1-database-rooms.md) | D1 | libellus | Opus |
| [`S1-trappist-layer-names.md`](S1-trappist-layer-names.md) | S1 | trappist (draft PR) | normal |
| [`W1-profile-switch.md`](W1-profile-switch.md) | W1 | libellus | normal |
| [`P1-progress-promise.md`](P1-progress-promise.md) | P1 | libellus | normal |
| [`D3-messages.md`](D3-messages.md) | D3 | libellus (stacked on D1's branch) | Opus |
| [`D2-position-from-progress.md`](D2-position-from-progress.md) | D2 | libellus (stacked on D1's branch) | Sonnet high |
| [`S2-trappist-realtime-core.md`](S2-trappist-realtime-core.md) | S2 | trappist (draft, stacked on S1's branch) | Sonnet high |
| [`S3-trappist-photo-klipy-errors.md`](S3-trappist-photo-klipy-errors.md) | S3 | trappist (draft, stacked on S2's branch) | normal |
| [`D4-realtime.md`](D4-realtime.md) | D4 | libellus (stacked on D3's branch) | Sonnet high |

The later PRs (S4–S6, W2–W5, K1, X1–X3) have their scope in part 3 and an outline in part 8.5 of the plan; the coordinator writes their spec from it when the blocker is near. Stacked PRs branch from their **base branch**, not from `main`, and open with that base until it merges.
