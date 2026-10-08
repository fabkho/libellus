# Contributing

Libellus is a personal project that a few people use every day. Issues are welcome: a bug, something
that reads wrong, a step in [docs/SETUP.md](docs/SETUP.md) that no longer matches the
dashboards. Pull requests are welcome for bugs, docs and small improvements; for a new feature,
please open an issue first and wait for a yes, since the app deliberately does one loop and stays
small (SPEC.md, "Non-goals").

Working on the code:

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) runs it locally; [web/AGENTS.md](web/AGENTS.md) has the
  rules the code follows (layers, tokens only, every string in `i18n/locales/en.json`, a
  `data-testid` on every control); [CONTEXT.md](CONTEXT.md) the words for things.
- Rules live in the database: a change to them comes with a migration and pgTAP tests
  (`supabase/tests/`). A change to the data layer comes with Vitest tests against the local stack, a
  change a member can see with a Playwright flow and its entry in [docs/parity.md](docs/parity.md).
- Commits are [conventional](https://www.conventionalcommits.org) (`fix(search): …`), one concern
  each, with a body that says why in full sentences.
- CI runs what your change touches (docs/TESTING.md, "CI: what runs when"); it has to be green.

Security problems: not in an issue, please — see [SECURITY.md](SECURITY.md).
