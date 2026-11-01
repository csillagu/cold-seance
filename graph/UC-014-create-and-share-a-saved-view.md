---
actor: Any user
---

# UC-014: Create and share a saved view

## Goal

Keep a named Kanban or Gantt that shows just the work the actor cares about, for themselves or for others, such as "MY kanban".

## Steps

1. The actor creates a new named view of the Kanban or Gantt kind ([SRC-108](SRC-108-kanban-and-gantt-support-saved-views.md)).
2. They choose where it is kept: in a project, in a group, or personally ([SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).
3. They choose which projects it covers; a group or personal view can cover several ([SRC-109](SRC-109-views-can-cover-several-projects.md), [SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).
4. They set its filters, on any task field, and optionally on the person viewing it (`@me`) ([SRC-116](SRC-116-saved-views-filter-on-any-task-field-and-on-the-vi.md)).
5. They save it. People who can see where it is kept can open it ([SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).

## Success criteria

- Each person who opens the view sees only the tasks they can read, so two people can see different tasks in the same view ([SRC-110](SRC-110-a-view-shows-only-the-tasks-its-viewer-can-read.md)), and `@me` resolves to whoever is viewing ([SRC-116](SRC-116-saved-views-filter-on-any-task-field-and-on-the-vi.md)).
- In a view that covers several projects, cards are editable only in projects the viewer can write to; the rest are read-only ([SRC-112](SRC-112-cards-in-a-cross-project-view-are-editable-only-wh.md)).
- A Gantt view that covers several projects draws the dependencies between them ([SRC-118](SRC-118-a-cross-project-gantt-draws-dependencies-between-p.md)).
- Creating a task in a view that covers several projects asks which project it goes in, offering only projects the viewer can write to; if the filter allows only one project, that one is used ([SRC-117](SRC-117-creating-a-task-in-a-cross-project-view-asks-for-i.md)).

## Failure modes

- A view never grants access: tasks the viewer cannot read are not shown ([SRC-110](SRC-110-a-view-shows-only-the-tasks-its-viewer-can-read.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
