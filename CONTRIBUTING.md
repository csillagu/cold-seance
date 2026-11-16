# Contributing to cold-seance

Thank you for considering a contribution. Bug reports, questions, fixes and features are all welcome. Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- **Bugs:** open an issue with the bug report form. For a security vulnerability, follow [`SECURITY.md`](SECURITY.md) instead.
- **Features and larger changes:** open an issue first, so we can agree what the tool should do before code is written. What the tool must do is recorded as requirements in [`graph/`](graph/), and a change in behaviour starts there. The README's [How the project is organised](README.md#how-the-project-is-organised) explains that graph and the plans built on it.
- **Small fixes** (typos, an obvious bug with a test): a pull request alone is fine.

## Making a change

1. Fork the repository and create a branch from `main`.
2. Set up the development environment as the [README's Development section](README.md#development) describes: Node.js 26 (see `.nvmrc`), `npm ci`, and PostgreSQL (Docker is easiest) for the integration and browser tests.
3. Make the change, with tests. Unit tests sit next to the code as `*.test.ts(x)`. Integration tests are in `backend/test/integration/`, and browser tests in `e2e/tests/`.
4. A change to the database schema needs its migration: run `npm run db:generate -w backend` and commit what it writes (see [Database schema](README.md#database-schema)).
5. Add a dependency with `npm install -w <package>`, so `package-lock.json` stays the one lockfile.
6. Run the checks:

   ```sh
   npm run check                 # format, lint, typecheck, db:check, unit tests, build
   npm run test:integration      # if the backend changed; needs TEST_DATABASE_URL
   ```

   `npm run format` fixes formatting.

7. Open a pull request against `main` and fill in the template: link the issue, say what changed and why, and list any decisions you made that the issue did not settle.

CI runs every check, the browser tests and the Docker image tests on each pull request. A maintainer reviews it and merges it with a merge commit.

## Commits

Keep each commit focused, with a message that says what changed and why, and reference the issue, such as `Add login form (#12)`.

## AI coding agents

Much of this repository is written by AI coding agents. [`CLAUDE.md`](CLAUDE.md) holds the rules they follow, and they apply to agent-written contributions from outside too. You are responsible for every change you submit, however it was written.

## License

cold-seance is licensed under the [Apache License 2.0](LICENSE). As section 5 of that license says, a contribution you submit for inclusion is licensed under the same terms, unless you state otherwise.
