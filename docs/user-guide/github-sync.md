# Repositories and the GitHub sync

The plan lives in cold-seance, and GitHub issues mirror it. On GitHub, people work on their issues as usual: they start, hold and finish them. Planning changes made on GitHub are undone. This page explains how repositories come into the tool and what syncs in each direction. The installation side (App, tokens, webhooks) is in [GitHub setup](github-setup.md).

- [Register a repository](#register-a-repository)
- [Add a repository to a project](#add-a-repository-to-a-project)
- [The receiving project](#the-receiving-project)
- [Seed a project from GitHub](#seed-a-project-from-github)
- [Give a task its issue](#give-a-task-its-issue)
- [From the tool to GitHub](#from-the-tool-to-github)
- [From GitHub to the tool](#from-github-to-the-tool)
- [Changes the tool undoes on GitHub](#changes-the-tool-undoes-on-github)
- [The re-check](#the-re-check)

## Before you start: link your GitHub account

Under **Your account → GitHub account**, enter your GitHub username. The tool uses the link to put you on your tasks' issues as an assignee, and to recognise the issues assigned to you when it seeds a project. People without a linked account can still be assigned to tasks. Their issues are created without them as a GitHub assignee. A system admin can set the link for anyone, from **Administration → Accounts**.

## Register a repository

A repository is its own item in the tool, with its own admins, who decide which projects may use it.

1. Open **GitHub → Repositories**.
2. Enter the repository as GitHub writes it, `owner/name`, and register it.

Anyone with an account can register a repository that is not registered yet, provided the tool can reach it on GitHub, through an App installed on it or a token that can read it. Whoever registers it becomes its first admin.

The repository's page lists its admins, so everyone knows whom to ask. An admin can add other admins by username, remove admins, or step down. A system admin can change the admins without becoming one. A repository always keeps at least one admin.

## Add a repository to a project

A project pulls issues from the repositories added to it, and its tasks can get issues only in those.

1. In the project, open **Repositories**. Only the project's admins can make changes there.
2. Choose a registered repository and ask to add it.
   - **If you are an admin of the repository too,** it is added at once.
   - **Otherwise,** the request waits for one of the repository's admins. They are notified, and decide in **GitHub → Repository requests**: approve, which adds the repository to the project, or reject. One admin's approval is enough.

A repository admin can later **withdraw** an approval. From then on the project pulls no new issues from the repository. The tasks it already has from the repository stay, with their fields and their link to the issue, but they are no longer synced with GitHub in either direction.

Several projects can pull from the same repository.

## The receiving project

When a new issue is opened on GitHub, it becomes an unscheduled task in one project:

- the repository's **receiving project**, if it has one;
- otherwise, the one project that pulls from the repository, if exactly one does;
- otherwise, no project.

An admin of a project that pulls from the repository marks it as the receiving project, on the project's **Repositories** page. A repository has at most one receiving project. While one project holds the role, marking another is refused, until the first project's admin gives it up.

New issues reach the tool only through a [webhook](github-setup.md#webhooks). Without webhooks, issues opened on GitHub do not become tasks by themselves. Use [seeding](#seed-a-project-from-github) to bring them in.

## Seed a project from GitHub

Seeding brings a repository's existing issues into a project, once, to start planning from what is already there.

1. Add the repositories to the project first, as above.
2. In the project, open **Seeding**, choose one or more of its repositories, and start the import. Only the project's admins can.

What comes in:

- **Open issues** become unscheduled tasks. A task is in progress if its issue is in the started option of the [Projects status field](github-setup.md#the-projects-status-field), on hold if it is in the on-hold option, and not started otherwise.
- **Closed issues** become done tasks, with the date the issue was closed as their actual finish.
- Each task is linked to its issue and assigned to its repository. Its assignees are the people whose linked GitHub accounts are assigned to the issue and who can read the project.
- **Sub-issues** become subtasks, and **blocked-by relations** become dependencies between the tasks.

What is skipped, and listed when the import ends:

- an issue that is already a task, in this project or another;
- an issue blocked by an issue that the import does not bring in.

Pull requests are left out. **Seeding is all or nothing.** All the issues are read from GitHub before anything is written, and if GitHub cannot be read, nothing is brought in. Seeding writes nothing to GitHub.

## Give a task its issue

A task gets a GitHub issue when it is **assigned to a repository**: on the task's page, choose one of the repositories its project pulls from. The tool creates the issue, titled after the task, and from then on keeps it in line. A task has at most one issue. If you move the task to another repository, it keeps the issue it has.

## From the tool to GitHub

The tool keeps the planning of every linked issue identical to its task:

| In the tool | On GitHub |
| --- | --- |
| The assigned people | The issue's assignees, for the people with a linked GitHub account |
| The parent task | The issue's parent issue (sub-issues) |
| The tasks it is blocked by | The issue's blocked-by relations |
| A fixed-date milestone's date | The due date of a GitHub milestone of its own, titled after the task and its issue number, that the issue is in |
| Cancelling the task | The issue closed as "not planned" |

A relation with a task that has no issue is left off GitHub. A relation on GitHub that the tool does not have is removed. Changes are written in the background, one task at a time. What fails, such as while GitHub is down, is put right at the next [re-check](#the-re-check).

## From GitHub to the tool

| On GitHub | In the tool |
| --- | --- |
| The issue moved to the started option of the status field | The task starts, and today becomes its actual start |
| Moved to the on-hold option | The task is put on hold. Its dates and load do not change. |
| The issue closed, by hand or by a merged pull request | The task is finished, and today becomes its actual finish |
| The issue closed as "not planned" | The task is cancelled |
| The issue reopened | A finished task goes back to in progress, and its actual finish is cleared |
| The issue deleted | The same as closed |
| A new issue opened (with webhooks) | A new unscheduled task in the [receiving project](#the-receiving-project) |

These come in **whatever the GitHub user's role in the tool, or none**. Anyone who can work on the issue on GitHub can start, hold and finish its task. The audit log records each one under the GitHub login of whoever made it.

## Changes the tool undoes on GitHub

**Planning edits made on GitHub are not accepted.** If someone changes an issue's assignees, sub-issues or blocked-by relations on GitHub, the tool sets them back to what the plan says.

**Status changes that break a constraint are reverted:**

- starting an issue whose blockers have not all finished: the status field is reset to the option it had;
- closing an issue whose blockers have not all finished, or that has an open sub-issue: the issue is reopened;
- deleting such an issue: it is created again and linked to the task in its place;
- any status change on an issue whose task is cancelled.

Each revert leaves a short comment on the issue explaining why, naming the unfinished blockers and open subtasks, and people subscribed to the issue or its project get a notification.

## The re-check

Every `github.recheckIntervalMinutes` (60 by default), the tool goes over every linked issue as if it had just changed, then writes every task's planning to GitHub again. This catches what webhooks missed, what GitHub was down for, and everything when there are no webhooks. After a restart, it runs at once only if it is due.

A change the re-check finds is recorded under whoever GitHub names for it: the person who closed the issue, or who last reopened it. Where GitHub names no one, such as for a deleted issue or a move in the status field, it is recorded under `(re-check)`.
