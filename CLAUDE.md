# CLAUDE.md

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

Keep pushing commits to the branch as work continues. When the work is done, mark the PR ready for review:

```sh
gh pr ready
```

### Merging

The user merges PRs. Only merge a PR yourself when the user explicitly asks you to.

PRs are merged with a merge commit (not squash or rebase-merge). Before merging, rebase the branch onto the latest `main` so it is up to date:

```sh
git fetch origin
git rebase origin/main
git push --force-with-lease
```

Use `--force-with-lease`, never plain `--force`, when pushing a rebased branch.
