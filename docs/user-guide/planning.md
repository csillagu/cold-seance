# Planning tasks and milestones

This page covers what a task is, how milestones, subtasks and dependencies shape the schedule, how people are assigned, and how a task moves from not started to done.

- [Tasks](#tasks)
- [Milestones](#milestones)
- [Subtasks and dependencies](#subtasks-and-dependencies)
- [How the schedule is worked out](#how-the-schedule-is-worked-out)
- [Who can do it, and who will](#who-can-do-it-and-who-will)
- [Person load and AI work](#person-load-and-ai-work)
- [Status](#status)
- [Cancelling a task](#cancelling-a-task)
- [Red flags](#red-flags)

Who may change what depends on your role in the project: see [roles](people-and-access.md#project-roles). In short, read-write members and admins plan, contributors set the status of their own tasks, and read-only members look.

## Tasks

Create a task with **New task** on the project's page, or on the Gantt. A task has:

| Field | Meaning |
| --- | --- |
| **Title** and **description** | What the work is |
| **Planned start** | The first day of work. Leave it empty for an unscheduled task. |
| **Duration** | Whole working days. With a start, it gives the planned finish. |
| **Planned finish** | Derived from the start and duration. For a task without a duration, set it directly. |
| **Effort** | An estimate of the work, as a number. It is recorded and can be filtered on, but does not change the schedule or anyone's load. |
| **AI share** | The percentage of the work an AI does. It lowers the people's load, not the duration. See [Person load](#person-load-and-ai-work). |
| **Repository** | One of the repositories the project pulls issues from. Choosing it creates the task's GitHub issue. See [GitHub sync](github-sync.md#give-a-task-its-issue). |
| **Who can do it** | An eligibility expression. See [below](#who-can-do-it-and-who-will). |
| **Who will do it** | The assigned people, with an optional load for each |
| **Parent, subtasks, blocked by** | The task's relations. See [Subtasks and dependencies](#subtasks-and-dependencies). |

Once created, the task opens on its own page, where you set who can and who will do it, and its relations. Clicking a task's title in any view opens the same editor as a dialog.

**Unscheduled tasks** have no planned dates. Tasks created from new GitHub issues arrive this way, and so do tasks brought in by seeding. Every view shows them: at the bottom of each Kanban column, and in their own lane at the bottom of the Gantt, where you schedule one by drawing its bar.

## Milestones

A milestone is a task that takes no time. It marks a point in the plan, such as a release or a deadline. A milestone has no duration, effort or AI share, no assigned people and no eligibility, and it cannot be a subtask or have subtasks.

**To create one, give a new task a duration of 0.** The form then hides the fields a milestone cannot have.

- **With a planned start,** it is a **fixed-date milestone**, pinned to that date. Scheduling never moves it. If what it waits for would push past it, the milestone turns red (see [Red flags](#red-flags)). You can change its date later.
- **Without a planned start,** it is a **floating milestone**. It lies on the day the last of the tasks it is blocked by finishes, and moves with them. While none of them has dates, it has none either.

Whether a task is a milestone, and which kind, is set when it is created and cannot change afterwards. An existing task cannot be given a duration of 0.

On GitHub, a fixed-date milestone's issue is put in a GitHub milestone of its own, whose due date is the milestone's date.

**Milestones across projects.** A task can be blocked by a milestone of another project, if you can read that project. If the milestone moves past the start of the task that depends on it, the dependency turns red in your project, and both projects' owners are notified. Your task is not moved: no project's plan ever changes because of another project.

## Subtasks and dependencies

There are three kinds of constraint, set on the task's page, or by drawing on the Gantt:

- **Subtask (parent and child).** A task can have subtasks, nested to any depth. A parent spans its subtasks' dates: it starts with the first and finishes with the last. A parent cannot be finished while one of its subtasks is open.
- **Blocked by.** If B is blocked by A, B cannot start, or finish, before A has finished. There is no lag: B starts on its next working day after A finishes. Within a project, moving A moves B.
- **Fixed date.** A fixed-date milestone, above.

A blocked-by relation that would make a cycle, such as A blocked by B and B blocked by A, is refused.

## How the schedule is worked out

Within a project, the tool reschedules for you whenever something changes:

- **The planned finish** is the start plus the duration in working days, skipping the task's non-working days.
- **A blocked task** starts on its next working day after its last blocker finishes.
- **A parent** spans its subtasks.
- **A floating milestone** lies on its blockers' last finish.

**Non-working days** are the company calendar's weekend and holidays, for every task, and the personal holidays of each person assigned to it. A task with nobody assigned uses the company calendar alone, and so does an assigned person who has not filled in a calendar of their own. A planned start or finish set on one of the task's non-working days is refused.

**What scheduling never does:**

- It never moves a fixed-date milestone.
- It never changes another project's plan.
- It never moves a task because its people became unavailable or overloaded, such as when someone adds a day off or is assigned elsewhere. The task turns red instead.
- It never moves anything to fix an overload.

## Who can do it, and who will

Every task has two separate lists of people.

**Who can do it** (eligibility) is a logical expression over people, at most two levels deep, built with AND and OR:

| Expression | Means |
| --- | --- |
| `Anna` | Only Anna |
| `Anna OR Béla` | Either of them |
| `Anna AND Béla` | Both, together |
| `Anna AND (Béla OR Csaba)` | Anna, with Béla or Csaba |
| `(Anna AND Béla) OR Csaba` | Anna and Béla together, or Csaba alone |

In the editor, you build the outer AND or OR from people and from groups, each group an AND or OR of people. A group cannot hold another group.

**Who will do it** (assignment) is a list of people. It may include people who are not in the eligibility expression. Some people can do anything and are not listed on every task, so the tool accepts this without a warning. Only assigned people count toward load.

Both lists may only name people who can read the project, that is, who have a role in it. Someone who loses their role stays on the task but is marked as unable to read the project. Nobody can be assigned to a milestone.

While a task has eligible people but nobody assigned, the person load view rates it (see [Views](views.md#person-load)):

- **Red:** every valid combination of eligible people would overload someone.
- **Amber:** some combinations would, others would not.
- **Green:** at least one combination fits.

## Person load and AI work

Each task has a **person load**, a percentage that applies to every assigned person on every working day from the task's planned start to its planned finish.

| Task | Person load | So |
| --- | --- | --- |
| A normal task, AI share 0% | 100% | The person is fully busy for the task's duration. |
| A partly AI task, AI share 50% | 100% minus the AI share: 50% | Two such tasks can run side by side for one person. |
| An AI-only task, AI share 100% | Any percentage you set, 1% by default; 0, fractions and more than 100% are allowed | The person only starts and checks it. Many can run at once. |

**Per person:** in the assignment editor, a single assignee's load can be overridden, such as 30% for one person on a long task. Left empty, the task's load applies to them.

A person's **daily load** is the sum of the loads of all their tasks active that day, **across all projects**. Above their capacity that day, they are **overloaded**, shown in red. Their capacity is set on their capacity page, such as 100% for full-time or 80% for part-time, and is 0 on the days of their absences. See [People, roles and calendars](people-and-access.md#capacity-and-absences).

Putting a task on hold does not change its dates or its load.

## Status

A task is **not started**, **in progress**, **on hold**, **done** or **cancelled**. Change it on the task's page or in the task dialog, by dragging its card on the Kanban, or on GitHub (see [GitHub sync](github-sync.md#from-github-to-the-tool)).

- **Starting** a task, setting it in progress for the first time, records today as its **actual start**. A task cannot start before all its blockers are done.
- **On hold** only marks the task. Its dates and load stay.
- **Finishing** it records today as its **actual finish**. A task cannot finish while a blocker is unfinished or a subtask is open.
- **Reopening** a finished task, setting it back to in progress or on hold, clears its actual finish and keeps its actual start.
- A task never goes back to not started.

"Today" is the date in the tool's time zone, which the installation sets (see [Configuration](configuration.md#time-zone)).

A **contributor** can start, hold and finish only the tasks they are assigned to. They cannot reopen a finished task or cancel one.

## Cancelling a task

Cancel a task on its page with **Cancel task**, and confirm. A cancelled task:

- stays in the project, in the Kanban's **Cancelled** column;
- frees its people's load;
- passes its blockers on: each task it blocked becomes blocked by what the cancelled task was blocked by, even a milestone of a project you cannot read;
- has its GitHub issue closed as "not planned".

A finished task cannot be cancelled, nor can a milestone that a task is blocked by. Cancelling cannot be undone: a cancelled task takes no further status changes. Closing an issue as "not planned" on GitHub cancels its task too.

## Red flags

The tool shows conflicts in red and notifies the people subscribed to the project. It never resolves them by itself.

| Red flag | When |
| --- | --- |
| **Overload** | A person's load on a day is above their capacity. It shows to every project they have work in that day. |
| **Assigned person unavailable** | One of a task's assigned people is overloaded on a day within it, or a holiday took one of its working days. |
| **Fixed-date milestone pushed** | What a fixed-date milestone is blocked by finishes after its date. |
| **Cross-project dependency** | Another project's milestone moved past the start of a task that depends on it. |

A red flag clears by itself once its conflict is gone, such as when someone reassigns the work, moves a date or changes their capacity.
