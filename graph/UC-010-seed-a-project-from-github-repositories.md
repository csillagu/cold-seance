---
actor: Project admin
---

# UC-010: Seed a project from GitHub repositories

## Goal

Start a project's plan from the issues already in one or more GitHub repositories, instead of retyping them.

## Preconditions

- The actor is the project's admin ([SRC-093](SRC-093-admin-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The tool's GitHub App is installed on each repository, by that repository's admin ([SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)).

## Steps

1. The actor chooses one or more existing repositories to seed the project from ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)).
2. They start the import.
3. The import brings in the issues with their sub-issue and blocked-by relations, assignees, and status ([SRC-074](SRC-074-a-project-can-be-seeded-from-existing-github-repos.md)).
4. Open issues land as unscheduled tasks in the project ([SRC-075](SRC-075-imported-open-issues-land-as-unscheduled-tasks-in.md)). Closed issues come in as done, with their actual finish ([DD-019](DD-019-the-initial-import-brings-in-closed-issues-too.md)).
5. The actor then plans the unscheduled tasks, as in "Triage a task that arrived from GitHub".

## Success criteria

- Every issue from the chosen repositories is a task in the project, with its relations, assignees and status, and each closed one has an actual finish.

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
