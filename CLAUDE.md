# CLAUDE.md

## Requirements (reqlite)

The requirements are a [reqlite](https://github.com/major-solutions/reqlite) graph: one markdown file per item in `graph/`, the type system in `ruleset/` (read `ruleset/readme.md` and `ruleset/ruleset.json` before authoring). `docs/` holds the frozen stakeholder input: never edit it.

### Setup

reqlite is a Claude Code plugin, not an MCP server. Cloud sessions start without it; install it with:

```sh
claude plugin marketplace add major-solutions/reqlite
claude plugin install reqlite@reqlite
```

The skills load from the next session. To run the engine in the current one, clone the repo (`git clone --depth 1 https://github.com/major-solutions/reqlite <dir>`) and call it as the skill does: `uvx --from "<dir>" --exclude-newer 2026-10-24 reqlite <command>` (`<dir>[review]` for review commands).

### Authoring

- A requirement the owner states in conversation is recorded as an SRC (`source: design session`, `evidence: design session <date>`) with their words quoted under "As received". When it overtakes an existing item, retire that item: absorb what is still valid, re-link its dependents, delete the file, and name the retired id and where its value went in the commit message.
- Add nothing the owner did not say. Where the input is silent (an actor, a failure mode), write that it is not stated and ask; do not fill it in.
- `certainty` and `negotiability` are the owner's judgement. The owner approved four defaults: `certainty: verified` on an SRC that quotes the owner's own words from a design session, `certainty: assumed` on a new UC until the owner has read it, `certainty: assumed` on a new FR, and `certainty: assumed` on a new SC until the owner confirms it, with `negotiability` left unset. Set no other value unless the owner gives it.
- UCs: `actor` in front matter; Goal, Preconditions, Steps, Success criteria and Failure modes as needed; every step links the SRC or DD it rests on; one scenario per UC; no mechanisms (APIs, formats, syntax) in the steps. System obligations, such as mirroring to GitHub or the audit log, go in FRs, not UCs. Each UC ends with an origin note saying it was composed from the linked items and awaits the owner's confirmation.
- Get ids from `reqlite next-id <PREFIX>`; never reuse a retired id.
- Before committing, `reqlite check --changed` must report 0 errors.

### Quality review

- Review every item you create or change in substance, with `reqlite review <ID> graph --gateway --model claude-sonnet-5-5`, three at a time. In cloud sessions `--subscription` and key mode are refused because `ANTHROPIC_BASE_URL` is set; `--gateway` goes over the session's own route and is billed like the session. The owner has approved this billing. Say how many reviews a batch will be before running it.
- Report findings as they are; the owner decides which to act on. Do not invent content to satisfy a finding. Exit 3 is an unreadable response, not a clean item. Do not re-run an unchanged item hoping a finding goes away.

## Code

The code is an npm workspace (`backend/`, `frontend/`); the README's Development section has the commands. Use Node.js 26. Before committing code, `npm run check` must pass, and `npm run test:integration` too when the backend changed (it needs `TEST_DATABASE_URL`, see the README). Add dependencies with `npm install -w <package>` so `package-lock.json` stays the one lockfile.

## GitHub workflow

Use the `gh` CLI for all GitHub operations (issues, PRs).

### Never commit to `main`

Every new commit goes to a feature branch, with no exceptions — even typo fixes need an issue and a branch. Repository rulesets enforce this, so direct pushes to `main` will be rejected. If you are on `main` and need to commit, start a feature branch first (see below).

### Starting a feature branch

Every feature branch has a matching GitHub issue. Open the issue first, then branch:

1. Open an issue describing the work:
   ```sh
   gh issue create --title "<short title>" --body "<what and why>"
   ```
2. Create the branch from an up-to-date `main`, named after the issue number:
   ```sh
   git checkout main && git pull
   git checkout -b <issue-number>-<short-slug>   # e.g. 12-add-login-page
   ```

If an issue for the work already exists, reuse it instead of opening a new one.

### Committing

- Keep commits focused, with a clear message saying what changed and why.
- Reference the issue in the commit message, e.g. `Add login form (#12)`.

### Pull requests

Open a draft PR early, once the branch has its first commit, so work in progress is visible:

```sh
git push -u origin <branch>
gh pr create --draft --base main --title "<title>" --body "Closes #<issue-number>

<summary of the change>"
```

The `Closes #<issue-number>` line links the PR to the issue and closes the issue when the PR merges.

Keep a **Decisions** section in the PR body, added to as the work goes: every choice the issue and the graph items did not make for you (a table or route shape, a reading of an item that could be read two ways, an edge case, a dependency, a deviation from the plan), each with why, what it rests on and what else was considered, or "None". [`plan/agent-prompt.md`](plan/agent-prompt.md) §7 gives the format. A choice about what the system must do is the owner's: ask it, do not record it as yours.

Keep pushing commits to the branch as work continues. When the work is done, mark the PR ready for review:

```sh
gh pr ready
```

### Merging

The user merges PRs. Only merge a PR yourself when the user explicitly asks you to. The one standing exception: an agent working a work-graph issue as [`plan/agent-prompt.md`](plan/agent-prompt.md) sets out merges its own PR, once CI has passed on a head rebased onto the latest `main` (the owner's instruction of 2026-11-05).

PRs are merged with a merge commit (not squash or rebase-merge). Before merging, rebase the branch onto the latest `main` so it is up to date:

```sh
npm run db:rebase          # fetches origin/main, rebases onto it, regenerates the branch's migration
git push --force-with-lease
```

Do not merge migrations by hand: `db:rebase` drops the branch's migration and generates it again after `main`'s, which is the only safe way (see `backend/scripts/migration-rebase.ts`). A plain `git fetch origin && git rebase origin/main` is fine for a branch that adds no migration.

Use `--force-with-lease`, never plain `--force`, when pushing a rebased branch.

### Keeping parallel branches apart

Several branches are open at once, so keep each change where it collides least:

- New tables go in a schema module of their own, `backend/src/db/schema/<name>.ts`, re-exported from `backend/src/db/schema.ts`. A module imports what it references from the module that holds it, never from `schema.ts`.
- In a list that every block adds to (the route groups in `backend/src/api/api.ts`, the services in `backend/src/service/services.ts`, imports, the re-exports in `schema.ts`), put the new line in its alphabetical place, not at the end.
- Put new code in new files rather than growing a shared one.
- Rows of the status table at the end of `docs/implementation-plan.md` are appended; `.gitattributes` makes git keep both sides' rows on a rebase.
