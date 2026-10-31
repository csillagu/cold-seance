> **Initial user requirements — frozen stakeholder input.**
>
> This is a verbatim copy of the stakeholder's original requirements document, kept as the
> starting input for this project. It is not maintained: do not edit it to track changes.
> The living requirements are the reqlite graph in [`graph/`](../graph/), whose SRC items
> quote this document.
>
> - Stakeholder: au (project owner)
> - Original: [Project Planning Tool – Requirements](https://claude.ai/artifact/TDATJrG285hzXTeTkwXbcS)
> - Copied: 2026-10-31, from revision 33 of the original

# Project Planning Tool – Requirements

2026-10-31 · au

## Purpose and principles

A self-hosted, open-source planning tool that is the single source of truth for tasks, assignments and schedules, with GitHub used only for execution status.

- **Single source of truth.** All planning (dates, constraints, assignments) lives in the tool. GitHub mirrors it and may only start, hold and finish tasks.
- **Automatic inside a project, flags across projects.** Constraints reschedule dates automatically within a project. Anything crossing a project boundary (shared people, shared milestones) never changes another project; it is shown as a red violation for the owners to resolve.
- **No global resource leveling.** Overloads are detected and shown, never fixed automatically across projects.
- **AI proposes, humans approve.** AI changes to the plan arrive as proposals that a person reviews and edits in the browser before they are applied.
- **One logic layer.** The UI, REST API and MCP server all go through the same service layer and the same validation rules.

## Views

Five views cover manual use; everything shown is also editable there unless noted.

| View | Purpose | Notes |
| --- | --- | --- |
| Kanban | Day-to-day status of tasks | Columns follow task status; per project and cross-project |
| Gantt | Schedule, dependencies, milestones | Shows constraint violations in red; optional baseline bars |
| Person load | Load per person per day across all projects | Red above 100%; amber when an unresolved eligibility choice could overload someone |
| Baseline variance | Planned vs baseline vs actual dates | Read-only, computed |
| Unscheduled inbox | Tasks created from GitHub that have no plan yet | Triage into a project, schedule, assign |

The Gantt and Kanban must also show AI proposals as a pending overlay while a proposal is under review (see API, MCP and AI proposals).

**Notifications** are in-app only: new red flags, proposals waiting for review, and changes the tool reverted on GitHub. The API and MCP server can read them. There are no email, Slack or other external notifications.

**Export:** the Gantt can be exported as a Mermaid gantt chart, which renders in GitHub markdown. It carries tasks, dates, dependencies and milestones; load and red flags are not part of the export.

## Tasks and constraints

Three constraint types are supported, and all three are enforced both in the tool and on GitHub.

| Constraint | Meaning | Scheduling effect |
| --- | --- | --- |
| Subtask (parent/child) | A task can have subtasks, nested | Parent spans its children's dates; a parent cannot finish while a child is open |
| Blocked by / blocking | B is blocked by A | B cannot start before A finishes; within a project, moving A moves B |
| Fixed date (milestones) | A milestone is pinned to a date | Never moved by scheduling; anything that would push it is a red violation |

Each task has at least: title, description, project, status, planned start and finish (or duration), effort, AI share (see Person load and AI work), eligibility expression, assigned people, linked GitHub issue (optional).

Tasks without planned dates are "unscheduled" and appear in the inbox, not the Gantt.

Cycles in blocking relations are rejected on write. Dependencies have no lag: a blocked task can start the next working day after its blocker finishes. Durations are whole working days. Hold only marks a task; it doesn't move its planned finish or remove its load.

## Assignment

Every task has two separate assignment levels: who **can** do it and who **will** do it.

1. **Eligibility (who can)**: a logical expression over people, up to 2 levels deep, using AND and OR.
    - Examples: `A`, `A OR B`, `A AND B`, `A AND (B OR C OR D)`, `(A AND B) OR C`.
    - Stored as a tree, e.g. `{"all": ["A", {"any": ["B", "C", "D"]}]}`.
2. **Assignment (who will)**: a concrete list of people.
    - May include people outside the eligibility expression; this is accepted, since some people can do anything and are not listed on every task.
    - Only assigned people count toward person load.

While a task has an eligibility expression but no assignment yet, the load view shows:

- **Red:** every valid combination overloads someone.
- **Amber:** some valid combinations overload someone, others don't.
- **Green:** at least one valid combination fits.

## Person load and AI work

Each task has a person-load percentage that applies to every assigned person for the task's whole duration; AI work lowers the percentage, not the duration. The percentage can be overridden per assignment (e.g. 30% on a long task).

| Task type | Person load | Example |
| --- | --- | --- |
| Normal (human) task | 100% | Assigned person is fully busy for the task's duration |
| Partly AI task | 100% minus the AI share | 50% AI → 50% load, so two such tasks can run in parallel for one person |
| AI-only task | ~0–1% | Person only starts it; still assigned to them; unlimited in parallel |

- Load per person per day = sum of the load of all their assigned tasks active that day, across all projects.
- Above the person's capacity that day = overloaded, shown in red. Nothing is moved automatically.

**Capacity and calendars**

- Each person has a capacity (e.g. 100% full-time, 80% part-time); load is measured against it.
- Each person has absences (vacation, sick leave) that set their capacity to 0 on those days. Availability is tracked in whole days.
- A shared working calendar defines working days and public holidays; scheduling skips non-working days, and per-person calendars can override it (e.g. different country holidays).

## Cross-project sharing

Both people and milestones can be shared across projects, and neither ever changes another project's plan automatically.

- **Shared resources (people):** people live in one global pool, not inside projects. Any project can make them eligible or assign them. Their load is summed across all projects; an overload is shown in red to every project involved.
- **Shared milestones:** a milestone belongs to one owning project. Other projects can depend on it (blocked by). If it moves past a dependent task's start, the dependency turns red in the dependent project; the dependent task's dates do not move. Depending on another project's milestone requires read access to that project. Both owners get an in-app notification; there is no separate change-request flow in v1.

- **Assigning shared people:** any project can make anyone from the pool eligible or assign them, as long as that person has at least read access to the project.
- **Load visibility:** a person's load always shows their total across all projects. The viewer sees exact tasks for projects they can read; load from other projects shows only as a percentage (e.g. "other projects: 60%").

## Baselines and actual dates

Planned dates are compared against saved baselines and against actual dates recorded during execution.

- **Baseline:** a named snapshot of every task's planned start and finish in a project (e.g. "v1 approved", "v2 after re-plan"). Multiple baselines per project are kept.
- **Actual start:** recorded when the task is started (in the tool or from GitHub).
- **Actual finish:** recorded when the task is finished (in the tool or from GitHub).
- **Variance:** computed, not stored: actual (or current plan) minus the selected baseline, per task and per milestone.

## GitHub integration

The tool owns the plan; GitHub issues mirror it and may only change execution status (start, hold, finish).

**Allowed from GitHub**

| Action in GitHub | Effect in the tool |
| --- | --- |
| Start | Task status → in progress, actual start recorded |
| Hold | Task status → on hold |
| Finish (close issue) | Task status → done, actual finish recorded |
| New issue created by a third party, or a non-plannable item (bug etc.) | Created in the tool automatically as an unscheduled task in the inbox |

Start and hold are set through the GitHub Projects status field; finish is closing the issue.

**Mirrored from the tool to GitHub (always kept identical)**

- Sub-issue relations ↔ subtasks
- Blocked-by / blocking relations ↔ task dependencies
- Assignees ↔ assigned people
- Fixed dates of milestones

**Rules**

- Planning edits made in GitHub (assignees, sub-issues, blocked-by) are not accepted; the tool restores its own state on GitHub.
- GitHub must not allow a status change that breaks a constraint; the tool reverts it. A blocked issue that gets closed is reopened (or recreated if deleted), a parent closed with open children is reopened, and a start on a blocked task is reset.
- Tasks planned in the tool create their GitHub issues; GitHub never creates planned tasks.

**Edge cases**

- A finished issue reopened on GitHub sets the task back to in progress and clears its actual finish.
- An issue closed as "not planned" is reopened by the tool; tasks can only be cancelled in the tool.
- A merged PR that closes an issue counts as finish.
- Every revert by the tool leaves a short comment on the issue explaining why.
- Tasks assigned to people without a GitHub account get issues without a GitHub assignee.
- Every issue is assumed to belong to exactly one project; no extra mapping rules.
- An hourly reconciliation job re-checks all linked issues, covering missed webhooks and GitHub downtime.

**Initial import (seeding from GitHub)**

A project can be seeded from one or more existing repos. The import brings in open and closed issues with their sub-issue and blocked-by relations, assignees, and status from the Projects status field. Open issues land as unscheduled tasks in the inbox; closed issues come in as done, with their actual finish taken from the GitHub Projects closing-date field.

## API, MCP and AI proposals

The tool has a normal REST API and an MCP server; AI agents change the plan only through proposals that a person approves.

- **REST API:** full read and write access to everything in the UI, with the same permission checks.
- **MCP server:** read access to the plan; write access only by creating proposals.

**Proposal flow**

1. AI creates a proposal: a set of changes (new tasks, date moves, assignments, constraints) against the current plan.
2. The proposal is shown in the browser as a diff on the Gantt and Kanban, without touching the live plan.
3. A person with write access can edit the proposal directly in the browser, then approve or reject it.
4. On approval, all changes are applied together; the live plan is overwritten only at this point.

**Stale proposals**

A proposal stores only planning inputs, never computed dates, and its preview is always recomputed against the live plan, so most plan changes don't make it stale.

1. **Inputs only.** A proposal holds inputs: new tasks, durations, effort, AI share, constraints, fixed dates, eligibility, assignments. Dates that the scheduler derives are not stored in it.
2. **Live preview.** Opening a proposal applies its inputs to the current plan in memory, runs the scheduler and shows the diff plus any new red flags. The reviewer always sees what approving would do now.
3. **Real conflicts only.** A change conflicts only if the same input on the same task was edited by someone else after the proposal was created, or the task was deleted. Conflicts are shown for the reviewer to resolve or drop.
4. **Grouped changes.** The AI groups changes that only make sense together; a group is approved, edited or dropped as one.
5. **Atomic approval.** Changes apply in one transaction against the plan version the reviewer saw; if the plan changed in between, the preview refreshes and the reviewer confirms again.
6. **Fallback.** If the preview no longer makes sense, the reviewer rejects it and asks the AI for a new one; nothing is rebased automatically beyond step 2.
7. Proposals untouched for 24 hours expire. A proposal may span several projects; each project's part is approved by someone with read-write access in that project.

## User management

Roles are assigned per project, so a user can be read-write in one project and read-only in another.

| Role | Can |
| --- | --- |
| Read-only | View all views and data; no edits |
| Read-write | Edit tasks, plans and assignments; review, edit and approve AI proposals |
| Admin | Everything above in that project, plus manage its members, roles, repo mapping and settings |

The same roles apply to API tokens and to the MCP server's access. Every change is recorded in an audit log: who made it, when, and through which channel (UI, API, MCP, GitHub).

**System access**

- Local accounts only for now; SSO may come later. There is no self-registration: a system admin creates accounts.
- Anyone with an account can create a project and becomes its admin.
- The GitHub App is installed on each repo by that repo's admin. It needs read and write access to issues, and to the GitHub Projects used for the status field.

## Decisions log

All open questions so far are decided; each decision is also written into the sections above.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Duration unit | Working days |
| 2 | Lag on dependencies | None; the blocked task can start the next working day |
| 3 | Availability granularity | Whole days |
| 4 | Finished issue reopened on GitHub | Task back to in progress; actual finish cleared |
| 5 | Issue closed as "not planned" on GitHub | Reverted: the tool reopens it; tasks are cancelled only in the tool |
| 6 | Merged PR closes an issue | Counts as finish |
| 7 | Repo to project mapping | Not needed; every issue is assumed to belong to exactly one project |
| 8 | People without a GitHub account | Issue is created without a GitHub assignee |
| 9 | Tool reverts a GitHub change | Leaves a comment on the issue explaining why |
| 10 | Missed webhooks, GitHub downtime | Hourly reconciliation of all linked issues |
| 11 | Hold | Only marks the task; planned finish and load unchanged |
| 12 | Assignment outside the eligibility expression | Accepted |
| 13 | Custom load % per assignment | Yes, overrides the default |
| 14 | Cross-project change-request flow | Not in v1; in-app notification only |
| 15 | Expiry of untouched proposals | 24 hours |
| 16 | Proposal spanning several projects | Allowed; each project approves its own part |
| 17 | Depending on another project's milestone | Requires read access to that project |
| 18 | Audit log | Yes: who, when, and channel (UI, API, MCP, GitHub) |
| 19 | GitHub import scope | Open and closed issues; closed ones get their actual finish from the GitHub Projects closing-date field |
| 20 | Gantt export | Mermaid gantt chart |
