# People, roles and calendars

People live in one pool across the installation, not inside projects. A person's role is set per project, so someone can be read-write in one project and read-only in another. Their load and calendars count across every project.

- [Accounts and system admins](#accounts-and-system-admins)
- [Projects](#projects)
- [Project roles](#project-roles)
- [Groups](#groups)
- [Capacity and absences](#capacity-and-absences)
- [Calendars](#calendars)
- [Your GitHub account](#your-github-account)

## Accounts and system admins

There is no self-registration, and accounts are local to the tool. A **system admin** creates every account, under **Administration → Accounts**, with a username and a password, and gives the person their credentials. The first system admin is set up by the installation's configuration (see [Configuration](configuration.md#the-first-system-admin)).

A system admin can also:

- make other people system admins;
- set anyone's GitHub account link, capacity, absences and working calendar;
- change the company calendar;
- change the admins of any registered repository;
- delete groups;
- read the whole audit log.

Being a system admin is not a role in any project. To work in a project, a system admin needs a role there like anyone else.

The tool has no screen yet for changing a password. Choose the passwords with that in mind.

## Projects

Anyone with an account can create a project, with **New project** in the navigation, and becomes its admin. Project names are unique across the installation.

The project's tabs lead to its views, its saved views and its proposals, then to its settings: **Members**, **Repositories**, **Seeding** and its **Audit log**. The **Proposals** tab counts the proposals waiting for review. **New task**, at the end of the tabs, is shown only to read-write members and admins; members, roles and repositories can be changed only by the project's admins, and nobody else is shown the controls.

A project you have no role in is invisible to you: the tool tells you so, and shows nothing of it.

## Project roles

A person has one of four roles in a project, from lowest to highest:

| Role | Can |
| --- | --- |
| **Read-only** | See every view and all data of the project. Change nothing. |
| **Contributor** | Everything read-only can, and start, hold and finish the tasks they are assigned to. Nothing else: they cannot reopen a finished task or cancel one. |
| **Read-write** | Edit tasks, plans, relations and assignments. Save baselines. Review, edit, approve and reject proposals. Create proposals through the REST API or the MCP server. |
| **Admin** | Everything read-write can, and manage the project's members and roles, its repositories and receiving project, and seed it from GitHub. |

- **Manage members** on the project's **Members** tab: add people by username with a role, change their roles, remove them. Only the project's admins can. A project always keeps at least one admin, so the last admin cannot be removed or demoted.
- **Roles also come through groups,** below. Where someone holds several roles on a project, directly and through groups, the highest applies.
- **The same roles apply everywhere:** in the browser, through the REST API and through the MCP server. An API token acts with its owner's roles.
- **To be eligible or assigned** for a project's task, a person needs a role in that project, read-only being enough.
- **Read-write members and admins are subscribed** to their projects' notifications automatically.

## Groups

A group gives its members a role on each of its projects. Use groups for teams that work across several projects.

- **Anyone** can create a group, under **Groups**, and becomes its admin. Every group is listed for everyone.
- **Members** each have a role in the group, one of the four project roles. They get that role on every project in the group, for as long as they are a member and the project is in the group.
- **The group's admins** add members by username with a role, change their roles and remove them. A group always keeps at least one admin.
- **Any member can leave** a group, except its last admin.
- **Projects:** on the group's **Projects** tab, anyone can create a new project in the group, and a project's admin can add an existing project to it.
- **Saved views** can be kept in a group, for its members (see [Saved views](views.md#saved-views)).
- **Only system admins can delete a group.** The group's saved views are deleted with it.

## Capacity and absences

Under **Your account → Capacity and absences**:

- **Capacity** is the share of full time you work, from 0% to 100%: 100% for full-time, 80% for four days a week, and so on. Your load is measured against it every day.
- **Absences**, such as vacation or sick leave, are recorded in whole days. On those days your capacity is 0, so any task you are assigned to during an absence makes you overloaded, and turns red.

Nobody's tasks are moved because of an absence or a change of capacity. The affected tasks turn red, for their planners to resolve.

## Calendars

**The company calendar** (**Company → Company calendar** in the navigation) holds the weekend days and the company holidays, for everyone. Only system admins can change it. The weekend is Saturday and Sunday until a system admin sets other days. No task is scheduled on a weekend day or a company holiday.

**Your working calendar** (**Your account → Working calendar**) holds your own days off, such as the public holidays of your country. Tasks you are assigned to are not scheduled on them. You have no weekend of your own: the company calendar's applies to everyone. If you leave your calendar empty, the company calendar alone applies to you.

[How the schedule is worked out](planning.md#how-the-schedule-is-worked-out) shows how these combine.

## Your GitHub account

Under **Your account → GitHub account**, enter your GitHub username. With the link, the tool makes you an assignee of your tasks' issues on GitHub, and recognises issues assigned to you when it seeds a project. Without it, you can still be assigned to tasks, and your tasks' issues are created without a GitHub assignee.

The person menu at the top right leads to the same settings, to your [API tokens](rest-api.md#tokens), and has **Sign out**.
