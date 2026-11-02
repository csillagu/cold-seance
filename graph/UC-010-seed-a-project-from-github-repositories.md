---
certainty: assumed
actor: Project admin
---

# UC-010: Seed a project from GitHub repositories

## Goal

Start a project's plan from the issues already in one or more GitHub repositories, instead of retyping them.

## Preconditions

- The actor is the project's admin ([SRC-093](SRC-093-admin-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- Each repository's admin has given the tool access to that repository ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)).
- Each repository is registered in the tool ([SRC-180](SRC-180-repositories-are-their-own-item-in-the-tool-with-a.md)), and one of its admins there has approved adding it to the project ([SRC-181](SRC-181-a-repository-s-admins-approve-adding-it-to-a-proje.md)), unless the actor is also an admin of the repository ([SRC-184](SRC-184-an-admin-of-both-the-repository-and-the-project-ad.md)).

## Steps

1. The actor chooses one or more existing repositories to seed the project from ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)).
2. They start the import.
3. They see the repositories' issues appear in the project with their sub-issue and blocked-by relations, assignees and status ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)). Open issues are unscheduled tasks ([SRC-075](SRC-075-imported-open-issues-land-as-unscheduled-tasks-in.md)); closed issues are done, with their actual finish ([DD-019](DD-019-the-initial-import-brings-in-closed-issues-too.md)).
4. They then plan the unscheduled tasks, as in "Triage a task that arrived from GitHub".

## Success criteria

- Every issue from the chosen repositories is a task in the project, with its relations, assignees and status, and each closed one has an actual finish.

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok". The precondition on the repository's admin in the tool was added for issue #7 and awaits the stakeholder's confirmation.
