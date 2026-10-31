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
