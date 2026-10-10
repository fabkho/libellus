# Repository hardening (security round, October 2026)

What was changed in the repository's settings and workflows for findings F5 to F8, F12, F20 to F24 of
`final-round-2026-10.md`, what is left for the owner, and the exact steps. Settings are not in git, so this file is
their record: re-check them when a collaborator is added.

## Applied

| Finding | What | Where |
| --- | --- | --- |
| F6 | Every third-party `uses:` (25, 10 actions) pinned to the full commit SHA with the tag as a comment. SHAs resolved again from the tags on 2026-10-10 and equal to the report's | `.github/workflows/*.yml` |
| F7 | Dependabot version updates, weekly, minor and patch grouped: npm in `/web` and `/design`, `github-actions` in `/`. It reads the `# vX` comment and bumps pin and comment together | `.github/dependabot.yml` |
| F7 | Dependabot alerts, Dependabot security updates, secret scanning, push protection, CodeQL default setup (`javascript-typescript`, `actions`, default query suite) switched on | repository settings, API calls below |
| F5 | Conservative ruleset on `main`: no deletion, no force push; repository admins bypass | repository ruleset `24849925` (JSON below) |
| F8 | `GIGET_AUTH` is gone from the jobs. Regal (`fabkho/regal`) is public, so the build downloads it with the run's own read-only `github.token`; the repository secret is unused and can be deleted. `secrets: inherit` is gone from both calls of `e2e.yml`, so a called workflow no longer receives `SUPABASE_ACCESS_TOKEN` and the other secrets | `ci.yml`, `e2e.yml`, `release.yml` |
| F12 | `robots.txt` and `.well-known/security.txt` are real files now (Pages serves a file before the HTML shell) | `web/public/` |
| F22 to F24 | [THIRD-PARTY.md](../THIRD-PARTY.md); the "repository is private" statements and a personal remark reworded | docs, README, CONTRIBUTING, SPEC |
| (SECURITY.md) | Private vulnerability reporting was already enabled; `SECURITY.md` and `security.txt` point to it | `SECURITY.md` |

### Calls made with `gh api` (all on `repos/fabkho/libellus`)

| Call | Result |
| --- | --- |
| `PUT actions/permissions/workflow` `default_workflow_permissions=read`, `can_approve_pull_request_reviews=false` | 200. **Reverted** with `can_approve_pull_request_reviews=true` (see F20 below); net change: none |
| `PUT vulnerability-alerts` | 204: Dependabot alerts on |
| `PUT automated-security-fixes` | 204: Dependabot security updates on (it opened its first pull requests for `simple-git` and `@simple-git/argv-parser` in `/web` at once: F19) |
| `PATCH .` `security_and_analysis.secret_scanning` and `.secret_scanning_push_protection` = enabled | 200: both `enabled` |
| `PATCH .` `security_and_analysis.secret_scanning_non_provider_patterns` and `.secret_scanning_validity_checks` = enabled | 200, but both still read `disabled` afterwards: the API accepts the call and ignores it. Owner click-path below |
| `PATCH code-scanning/default-setup` `state=configured`, `query_suite=default`, languages `javascript-typescript`, `actions` | 202: CodeQL default setup configured (free on a public repository; it scans pushes to `main`, pull requests and weekly) |
| `POST rulesets` (JSON below) | 201: ruleset `24849925`, `active`, rules `deletion` and `non_fast_forward` on `refs/heads/main`, bypass: repository admin role. `GET rules/branches/main` lists both rules |

Read-only calls: `GET` of the repository, `actions/permissions[/workflow]`, `rulesets`, `vulnerability-alerts`,
`private-vulnerability-reporting` (already `enabled`), `code-scanning/default-setup`, `keys`, `environments`, `actions/secrets`.

### The ruleset that is active

```json
{
  "name": "main: no deletion, no force push",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [ { "type": "deletion" }, { "type": "non_fast_forward" } ],
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ]
}
```

Deliberately **no** required pull request and **no** required checks: the coordinator and release-please merge through
pull requests and the owner pushes docs straight to `main`. The only force push in the workflows is to the branch
`production` (`release.yml`, rollback), which this ruleset does not cover.

## Not applied, and why

### F20: Actions must not approve pull requests (not changed)

The report says no workflow uses the setting. It does: **release-please opens the release pull request with
`GITHUB_TOKEN`, and GitHub allows that only when "Allow GitHub Actions to create and approve pull requests" is on**
(`docs/OPERATIONS.md`, "What it needs"); the one API field `can_approve_pull_request_reviews` is that checkbox, there is
no way to allow creating and forbid approving. Turning it off was tried and reverted before it could break the next
release. The risk it carries is small today (no rule requires an approving review, so an approval by Actions
bypasses nothing). It becomes real with the stricter ruleset below ("require approvals"). To close it:

1. Create a fine-grained PAT or a GitHub App for release-please (`contents`, `pull-requests`, `issues`: write on this
   repository only), store it as environment secret `RELEASE_PLEASE_TOKEN` in a `release` environment limited to `main`.
2. In `release.yml` give `googleapis/release-please-action` `token: ${{ secrets.RELEASE_PLEASE_TOKEN }}`. A pull request
   opened with a PAT or App also starts CI, which the required checks need.
3. Then run `gh api -X PUT repos/fabkho/libellus/actions/permissions/workflow -f default_workflow_permissions=read -F can_approve_pull_request_reviews=false`.

### F6: require pinned actions

`sha_pinning_required` is still `false`: switching it on before the pins are on `main` would fail every run that uses a
tag. After this pull request is merged: Settings → Actions → General → **Require actions to be pinned to a full-length
commit SHA** (or `gh api -X PUT repos/fabkho/libellus/actions/permissions -F enabled=true -f allowed_actions=all -F sha_pinning_required=true`).

### F7: what is left (owner click-path)

Settings → Code security: **Secret scanning → Scan for non-provider patterns** and **Validity checks** (the API call is
accepted and ignored); check that CodeQL's first run finished (Security → Code scanning) and that Dependabot's pull
requests for `simple-git` are handled together with F19.

### F5: the stricter ruleset (proposal, for the owner to apply)

Apply when releases no longer depend on a pull request that runs no CI (F20 steps 1 and 2) and the owner is willing to
merge through pull requests. Settings → Rules → Rulesets → New branch ruleset, or `gh api -X POST repos/fabkho/libellus/rulesets --input main-strict.json`.
The check names are the jobs' `name:` in `ci.yml`; a skipped job counts as passed (`ci.yml` says so), so a docs-only
pull request is not blocked. Untested: `integration_id` 15368 is GitHub Actions.

```json
{
  "name": "main: pull request and checks",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "what changed", "integration_id": 15368 },
          { "context": "database rules (pgTAP), data layer (Vitest) and backup", "integration_id": 15368 },
          { "context": "tokens, web build and edge functions", "integration_id": 15368 }
        ] } }
  ],
  "bypass_actors": [ { "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" } ]
}
```

Once a second maintainer exists: `required_approving_review_count: 1`, `require_code_owner_review: true`, and a
`CODEOWNERS` for `.github/**`, `supabase/migrations/**` and `scripts/**`; and consider removing the admin bypass.
The ruleset above replaces the active one (delete `24849925` or edit it).

A second ruleset on the branch `production`, so that only the deploy key moves it (the rollback force-pushes it, so the
key needs `non_fast_forward` bypass there and is **not** a bypass actor on `main`):

```json
{
  "name": "production: only the deploy key",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/production"], "exclude": [] } },
  "rules": [ { "type": "update" }, { "type": "deletion" }, { "type": "non_fast_forward" } ],
  "bypass_actors": [ { "actor_id": 165764655, "actor_type": "DeployKey", "bypass_mode": "always" } ]
}
```

The `actor_id` is a placeholder for the deploy key's id (`gh api repos/fabkho/libellus/keys`): ids of deploy keys as
ruleset bypass actors are not verified; if the API refuses the type, restrict the branch to repository admins and keep
the key as it is.

### F8: secrets (owner checklist)

Done in the workflows: no secret reaches `ci.yml` / `e2e.yml` jobs. Left, in the GitHub UI (needs the owner; no API call
was made, moving a secret means re-entering its value):

1. Settings → Secrets and variables → Actions → **delete** `GIGET_AUTH` (unused now). Also revoke the token behind it.
2. Settings → Environments → **`production`**: add the secret `SUPABASE_ACCESS_TOKEN` (same value; the deploy job runs in
   this environment, `release.yml`); then delete the repository-level `SUPABASE_ACCESS_TOKEN`. Rotate it
   (Supabase dashboard → Account → Access Tokens: create a new one, use it here, revoke the old one); prefer the
   least-scoped token available.
3. Settings → Environments → **New environment** `backup`, deployment branches **Selected branches → `main`**. Add
   `SUPABASE_DB_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY` there, delete the repository-level copies,
   rotate the R2 key. Then add `environment: backup` to the job in `backup.yml` (not done here: the job would stop finding its
   secrets until step 3 is finished, and the nightly backup must not break in between).
4. Check afterwards: Actions → Backup → Run workflow once (owner, by hand).

### F21: the write-enabled deploy key

Kept, with its reasons written down. The `production` branch needs a push by something other than `GITHUB_TOKEN`
(GitHub refuses a `GITHUB_TOKEN` push that brings changed workflow files), and a deploy key is limited to this one
repository (a fine-grained PAT can be limited to it as well, but belongs to a person and expires). The risks: the key can
write to every branch, and it sits in the `production` environment. What lowers them: the environment only runs
for `main`, `release.yml` checks that the tag is an ancestor of `origin/main` and only moves forward, the key is not
a bypass actor on `main` (the ruleset above), and the `production` ruleset proposal limits who may move that branch.
The environment has **no required reviewers on purpose**: merging the release pull request is the approval. To
reduce it further, replace the deploy key with a fine-grained PAT or an App whose only permission is contents: write
on this repository, behind the `production` ruleset above.

## Licence

The repository carries the MIT licence (`LICENSE`, added in "chore: license Libellus under MIT"; README says so). No
licence file was added or changed in this round. If the owner prefers "all rights reserved" while the project is a
public beta, that is a replacement of `LICENSE` and of the README sentence, not an addition; it is the owner's
decision and was **not** made here.
