# Getting started

This walks through a new installation, from the first sign-in to a first planned project. It assumes the tool is installed and configured, as [Docker Compose](install-docker.md) or [Windows](install-windows.md) describes, with GitHub access [set up](github-setup.md).

## 1. Sign in as the first admin

Open the tool's address and sign in with the `firstAdmin` username and password from the configuration. That account is a **system admin**: it administers accounts and the company calendar. In projects, it is a person like any other.

## 2. Set up the company calendar

Under **Company → Company calendar**, check the weekend days (Saturday and Sunday unless you change them) and add the company holidays. No task is scheduled on them.

## 3. Create the accounts

Under **Administration → Accounts**, create an account for each person, with a username and a password, and give them their credentials. There is no self-registration. Make anyone who should help administer the installation a system admin too.

Ask each person to fill in, under **Your account**:

- **GitHub account:** their GitHub username, so they show as assignees on GitHub.
- **Capacity and absences:** their share of full time, and their vacations and other days off.
- **Working calendar:** their own public holidays, if they differ from the company's.

A system admin can fill these in for anyone, from the accounts list.

## 4. Create a project

With **New project** in the navigation, name the project. You become its admin. On its **Members** tab, add people by username, each with a role:

- **Read-only** to follow along;
- **Contributor** to start, hold and finish their own tasks;
- **Read-write** to plan and to review AI proposals;
- **Admin** to also manage members and repositories.

For a team that works across several projects, create a **group** instead, under **Groups**, add the team to it with their roles, and add the projects to the group. See [People, roles and calendars](people-and-access.md).

## 5. Connect a repository

1. Under **GitHub → Repositories**, register the repository as `owner/name`. You become its admin in the tool.
2. On the project's **Repositories** tab, add it to the project. As an admin of both, you add it at once. Otherwise one of the repository's admins approves the request.
3. On the same tab, mark the project as the repository's **receiving project**, so that new issues opened on GitHub arrive in it: at once with [webhooks](github-setup.md#webhooks), at the next re-check without.
4. To bring in the issues the repository already has, use the project's **Seeding** tab. Open issues arrive as unscheduled tasks, and closed ones as done.

[Repositories and the GitHub sync](github-sync.md) explains each step.

## 6. Plan

- Create tasks with **New task**, on the project's page or on the Gantt. Give each a planned start and a duration in working days.
- Create milestones by giving a new task a duration of 0: with a planned start it is pinned to that date, without one it floats after what it waits for.
- Link tasks on their pages, or by drawing on the Gantt: subtasks, and "blocked by".
- Say who **can** do each task (eligibility) and who **will** (assignment).
- Assign a task to a repository to create its GitHub issue.

[Planning tasks and milestones](planning.md) covers all of it.

## 7. Follow the work

- The **Kanban** shows where each task stands. On GitHub, people start and hold issues in the Projects status field and finish them by closing them, and the Kanban follows.
- The **Gantt** shows the schedule, with violations in red.
- **Person load** shows who is overloaded, across all projects.
- Save a **baseline** when the plan is agreed, and compare against it in **Baseline variance** later.
- **Notifications** tell you of new red flags, proposals waiting for review and changes reverted on GitHub.

See [The views](views.md) and [Notifications and the audit log](notifications-and-audit-log.md).

## 8. Bring in an AI assistant (optional)

Create an API token, connect your assistant to the MCP server, and let it propose changes for you to review. See [AI proposals and the MCP server](mcp-and-proposals.md).
