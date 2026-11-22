# The views

Each project has these views, as tabs on the project's page: **Kanban**, **Gantt**, **Person load** and **Baseline variance**. **Saved views** show a Kanban or a Gantt with a filter, across one or more projects.

Anyone with a role in the project can open every view. What you can change in a view depends on your role: see [roles](people-and-access.md#project-roles). In every view, clicking a task's title opens the **task dialog**, the one editor of a task, which offers only what your role allows. A refused change is shown with the reason.

- [Kanban](#kanban)
- [Gantt](#gantt)
- [Person load](#person-load)
- [Baseline variance and baselines](#baseline-variance-and-baselines)
- [Saved views](#saved-views)
- [Exporting the Gantt to GitHub markdown](#exporting-the-gantt-to-github-markdown)
- [Proposals in the views](#proposals-in-the-views)
- [Finding a project](#finding-a-project)

## Kanban

The day-to-day view of where work stands. There is one column per status: **Not started**, **In progress**, **On hold**, **Done** and **Cancelled**. Unscheduled tasks are at the bottom of each column. Each card shows the task and the people assigned to it, and turns red when the task has a [red flag](planning.md#red-flags).

- **Drag a card** to another column to change its status. The same rules apply as anywhere else: a blocked task cannot start, a parent with open subtasks cannot finish. A refused move is shown on the card.
- **Click a title** to edit the task.

After each change the Kanban is read again, since a change can move other tasks too.

## Gantt

The schedule: a table of tasks on the left, a timeline on the right.

- **Bars** are tasks on their planned dates, **diamonds** are milestones, and **arrows** are blocked-by relations. A dependency on another project's milestone is drawn as such.
- **Red** marks a fixed-date milestone pushed past its date, a cross-project dependency that turned red, and a task whose assigned people cannot do it in its time.
- **Faded** bars are cancelled tasks. **Unscheduled** tasks have a lane each, below the scheduled ones.

Editing on the Gantt, for read-write members and admins:

| To | Do this |
| --- | --- |
| Move a task | Drag its bar by the middle. It moves by whole days. |
| Change its start or finish | Drag one end of its bar. |
| Make one task blocked by another | Drag from the handle at the end of the blocker's bar to the other task. |
| Schedule an unscheduled task | Drag out its bar on its lane. For a fixed-date milestone, click the day. |
| Create a task | **New task**. A duration of 0 makes a [milestone](planning.md#milestones). |
| Edit anything else | Click the task's title or bar. |

Done and cancelled tasks are frozen. A parent's bar follows its subtasks, and a floating milestone follows its blockers, so neither can be dragged. After each change the Gantt is read again, since the scheduler may have moved the tasks that depend on the one you changed.

**Baseline bars:** choose a baseline in **Baseline:** above the Gantt, and its bars are drawn under the planned ones. Choosing one changes nothing.

The Gantt shows the plan as it was when you opened it. Reload the page to see changes other people have made since.

## Person load

Each member of the project, day by day, with their **whole load across all projects** against their capacity. The span is four weeks from this week's Monday. Change it with the dates above the view.

- A day above the person's capacity is **red**: they are overloaded. The tool never moves tasks to fix it. Reassign, reschedule or change the AI share to resolve it.
- You see the exact tasks behind a load for the projects you can read. The load from projects you cannot read shows only as a percentage, such as "other projects: 60%".

Below the chart, **unassigned tasks** are the project's tasks that have eligible people but nobody assigned. Each is rated, in colour and in words:

- **Red:** every valid combination of eligible people would overload someone.
- **Amber:** some combinations would, others would not.
- **Green:** at least one combination fits.

[Person load and AI work](planning.md#person-load-and-ai-work) explains how load is counted.

## Baseline variance and baselines

A **baseline** is a named snapshot of every task's planned start and finish in a project, such as "v1 approved" or "v2 after re-plan". A project keeps as many as you save.

**Save one** with **Save baseline** on the **Baseline variance** tab. Only read-write members and admins can save one. Each name must be unique in the project.

The **Baseline variance** view is read-only. It shows each task's planned, baseline and actual dates side by side, with each date's variance against the selected baseline: the actual date, or the current plan where there is no actual date yet, minus the baseline. The last saved baseline is selected when the view opens. Choose another above the table. Variance is computed each time, never stored.

## Saved views

A saved view is a Kanban or a Gantt with a name, a filter and a choice of projects. Saved views are how you get a view **across several projects**, or "my tasks" for each person.

**Create one** from **Saved views** in the navigation (or the project's **Saved views** tab), with **New view**:

1. Give it a name, and choose Kanban or Gantt.
2. Choose where it is kept, which decides who sees it and what it can cover:

   | Kept in | Seen by | Can cover |
   | --- | --- | --- |
   | A project | Everyone who can read the project | That project |
   | A group | The group's members | Some of the group's projects |
   | Personal | Only you | Some of the projects you can read |

3. Build the filter: conditions that a task must all meet, each on one field. The fields are title, description, status, planned and actual dates, duration, effort, AI share, milestone, eligibility, assigned people, project, repository and GitHub issue number. A condition on the eligibility or the assigned people can name **the person viewing**, so that one view shows each viewer their own tasks.

A saved view never grants access. Everyone who opens it sees only the tasks of projects they can read now. On a view across projects, each change is allowed or refused by your role in that card's project. **New task** asks which project the task goes in, offering those you can write to, unless the filter allows only one.

A saved view cannot be changed once saved: save a new one instead. Deleting a group deletes the views kept in it.

## Exporting the Gantt to GitHub markdown

**Export as Mermaid** on the Gantt gives the project's Gantt as a [Mermaid](https://mermaid.js.org/) gantt chart. Copy it into an issue, a pull request, a wiki page or a README on GitHub, where it renders as a chart:

````markdown
```mermaid
gantt
  ...the exported chart...
```
````

The export carries the tasks, their dates, dependencies and milestones. Load and red flags are not part of it.

## Proposals in the views

While an [AI proposal](mcp-and-proposals.md) that changes the project is waiting for review, the Kanban and the Gantt show what it would change, apart from the live plan:

- on the Kanban, a dashed box on each card it would change, and dashed cards for the tasks it would create;
- on the Gantt, dashed bars beside the live ones, and rows of their own for new tasks.

A line above the view names the proposal and links to its review. Nothing in the plan changes until the proposal is approved, and pending items cannot be dragged or edited.

## Finding a project

The search bar in the header finds projects by any part of their name, in any case, among the projects you have access to. The navigation lists all your projects.
