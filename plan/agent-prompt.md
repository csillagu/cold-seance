# Agent prompt: take the next work-graph issue

Start any number of agent sessions on this repository with this one line:

> Read `plan/agent-prompt.md` in this repository and follow it.

Each session then picks an open issue of the [parallel work graph](work-graph.md) that is ready and not taken, claims it, does it, and merges its pull request once CI passes. That merge closes the issue and unblocks the issues after it. Then the session takes the next ready issue, until none is ready. No one hands out the issues and no one merges by hand. Start a few sessions, say four to six; start another only if all of them have stopped while issues are still open. The rest of this file is the instructions for the agent.

---

You are one of several agents working on this repository at the same time. Each of you takes one issue of the parallel work graph at a time, does it and merges it, then takes the next, until no issue is ready. The issues and their order come from [`plan/work-graph.yaml`](work-graph.yaml), created by [`plan/create-issues.py`](create-issues.py).

## 1. Read first

Read `CLAUDE.md`, the README and [`plan/work-graph.md`](work-graph.md). `CLAUDE.md` binds you throughout: the branch rules, the checks before a commit, the reqlite rules, and never merging.

## 2. Find the issues you may take

An issue is **ready** when all of these hold:

- It is open and has the label `work-graph`.
- It has neither the label `claimed` nor the label `needs-owner`.
- Every issue in its **Blocked by** section is closed. A blocker closes when the pull request that implements it is merged. The issue's "blocked by" relations on GitHub say the same; if the two ever disagree, the section in the body wins.

If no issue is ready, say so, list the open ones with what each is waiting for, and stop. Do not take a blocked issue, and do not take one with `needs-owner`.

## 3. Pick one

Of the ready issues, take the one with the lowest **Rank** in its body. Rank 1 starts the longest chain of work still to do, so the lowest rank is the one that holds up the most. On a tie, take the lower issue number.

## 4. Claim it

Other agents may be choosing at the same moment, so claim it in this order:

1. Add the label `claimed`, and comment on the issue: `Claimed by <a link to this session, or its name>.`
2. Read the issue's comments again. If a `Claimed by` comment from another session is older than yours, you lost the race. Delete your comment, leave the label as it is, and go back to section 2 for another issue.
3. If yours is the oldest claim, the issue is yours.

A claim older than 24 hours, with no pull request linked to the issue and no commit since the claim, is stale. You may take it over: comment `Taking over the stale claim of <the other session>.` and carry on.

## 5. Branch and draft pull request

Work on a branch named `<issue-number>-<short-slug>`, from an up-to-date `main`, as `CLAUDE.md` says. If your session was given a branch to work on, use that one instead; for each later issue, restart it from the latest `main` (`git fetch origin main && git checkout -B <branch> origin/main`, as its earlier pull request is merged) and open a new pull request. After the first commit, open a **draft** pull request whose body starts with `Closes #<issue-number>`, so that the others can see the issue is taken.

## 6. Do the work

The issue body lists what to build and what to test:

- **SCs**: build each one as its SC file in `graph/` describes. Read the FRs and DDs it links. Do what it says it delivers, and add nothing it does not.
- **TCs**: write each TC listed, or the part of it the issue names, as a test, with the TC's id in its name, as the existing tests do. `full` means the TC passes in full here. A part means only that part does. For the rest of the TC, leave a `// Pending: ...` note naming the SCs it waits for, like the notes already in `backend/test/integration/`.
- **Browser parts** of TCs are Playwright tests (node P01 sets them up). A frontend issue follows the frontend design (node D01).
- **Backend issues** also add, as the tracks require, their tables and a migration (SC-073), their routes (SC-026) and those routes' OpenAPI description (SC-063).
- When the SCs are done, add a row for each to the **Status** table at the end of `docs/implementation-plan.md` (`| SC-xxx | implemented | #<issue> | <pull request link> |`), as the earlier pull requests did.

Keep your change apart from the others' work, as `CLAUDE.md`'s "Keeping parallel branches apart" sets out: new tables in a schema module of their own, new lines in shared lists in their alphabetical place, new code in new files. Bring `main` in early and often: run `npm run db:rebase` when you start and whenever `main` has moved. It fetches `origin/main`, rebases onto it, and generates your migration again after `main`'s. Never merge migration files by hand.

Before each commit, run `npm run check`, and `npm run test:integration` too if the backend changed (see the README). If you changed anything in `graph/`, follow `CLAUDE.md`'s reqlite rules: run `reqlite check --changed`, then the quality review.

## 7. Record every decision in the pull request

You merge without a reviewer, so the pull request is the only record of what you chose. Keep a **Decisions** section in its body, and add to it as you go, not at the end. A decision is any choice the issue, its SCs, FRs, DDs and TCs did not make for you. For example:

- **Shape:** a table, column, constraint or index; a route's path, method, request or response; an error code or message.
- **Reading:** how you read an SC, FR or TC that could be read more than one way.
- **Edges:** behaviour at an edge the items do not mention, such as an empty list, a duplicate, or two changes at once.
- **Structure and tools:** where code lives, which module it reuses, a dependency you added, a pattern you followed or broke.
- **Tests:** what a TC part covers here, and what you left pending and why.
- **Deviations:** anything you did differently from the issue or the work graph, such as a part moved to another node or a blocker you found missing.

Write each as one bullet:

```markdown
## Decisions

- **<what was decided>.** Why: <the reason>. Rests on: <SC/FR/DD/TC ids, or "my choice">. Considered: <the options you did not take, if any>.
```

Write "None" if there were none, so that a reader knows the section was not forgotten. Also list under **Open points** anything left for later, with the issue or node it belongs to.

These are decisions you may take yourself. A decision about what the system must do, for whom, or when, is the owner's (section 8): ask it, do not record it as yours.

## 8. When the owner must decide

If the work needs a decision that the SC, its FRs, DDs and TCs do not settle, and that is about what the system must do rather than how it is built, do not guess. Commit and push what you have, then comment on the issue with the question and the options you see. Add the label `needs-owner`, remove `claimed`, and stop. The owner answers there, removes `needs-owner`, and the next agent picks the issue up again.

## 9. Merge

You merge your own pull request; the owner allows it for work-graph issues (see `CLAUDE.md`). Merge only a head that is rebased onto the latest `main` and has passed CI, and whose pull request body has its **Decisions** section complete for everything in that head:

1. **Rebase.** Run `npm run db:rebase`. If it stops on a conflict outside the migrations, resolve it, run `git rebase --continue`, then run `npm run db:rebase` again. Rows of the status table in `docs/implementation-plan.md` merge on their own; if one does conflict, keep both sides' rows.
2. **Check.** Run `npm run check` and, if the backend changed, `npm run test:integration`. Fix what fails.
3. **Push** with `git push --force-with-lease`, and mark the pull request ready for review.
4. **Wait for CI** on that head to finish. Use what your environment offers: `gh pr checks <number> --watch`, or the pull request's activity events. Do not poll in a tight loop.
5. **CI failed:** fix it, and go back to step 2.
6. **`main` moved** since your rebase (`git fetch origin main`, then compare `origin/main` with your branch's base): go back to step 1. Merge only a head CI has passed on top of the current `main`.
7. **Merge** with a merge commit, not squash or rebase-merge. If GitHub refuses (a review the rules require, a conflict that appeared meanwhile), go back to step 1 for a conflict. For anything else, comment on the issue with what GitHub said, add `needs-owner`, and stop.
8. **Check `main`** after the merge: wait for CI's run on `main` for your merge commit. If it fails, fix `main` at once with a new pull request that references the same issue, merged the same way. A red `main` blocks every other agent.

## 10. Finish

Comment on the issue with a summary: what was built, which TCs pass in full, which parts are pending and on what, and a link to the pull request's Decisions section. The merge closes the issue through `Closes #<issue-number>`; if it is still open, close it.

Then go back to section 2 and take the next ready issue, starting from an up-to-date `main` on a new branch. Carry nothing over from the last issue but what is merged: its branch is done. When no issue is ready, list the open ones with what each is waiting for, and stop.
