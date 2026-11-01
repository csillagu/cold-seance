---
certainty: assumed
actor: Any user
---

# UC-014: Create a saved view

## Goal

Keep a named Kanban or Gantt that shows just the work the actor cares about, for themselves or for others, such as "MY kanban".

## Preconditions

- A view kept in a project can cover only that project, a group view only the group's projects, and a personal view only what its owner can read ([SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).

## Steps

1. The actor creates a new named view of the Kanban or Gantt kind ([SRC-108](SRC-108-kanban-and-gantt-support-saved-views.md)).
2. They choose where it is kept: in a project, in a group, or personally ([SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).
3. They choose which projects it covers; a group or personal view can cover several ([SRC-109](SRC-109-views-can-cover-several-projects.md), [SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).
4. They set its filters, on any task field, and optionally on whoever is viewing it ([SRC-116](SRC-116-saved-views-filter-on-any-task-field-and-on-the-vi.md)).
5. They save it.

## Success criteria

- People who can see where the view is kept can open it: anyone who can read the project, the group's members, or only its owner ([SRC-111](SRC-111-views-are-kept-in-a-project-a-group-or-personally.md)).
- A filter on the viewer shows each person their own tasks ([SRC-116](SRC-116-saved-views-filter-on-any-task-field-and-on-the-vi.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
