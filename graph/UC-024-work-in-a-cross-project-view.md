---
certainty: verified
actor: Any user who can see the view
---

# UC-024: Work in a cross-project view

## Goal

Follow and change work across several projects from one Kanban or Gantt.

## Preconditions

- A saved view covers several projects ([SRC-109](SRC-109-views-can-cover-several-projects.md)).

## Steps

1. The actor opens the view. It shows only the tasks they can read ([SRC-110](SRC-110-a-view-shows-only-the-tasks-its-viewer-can-read.md)).
2. They do with each card whatever their role in its project lets them do from another view, where this view supports it ([SRC-138](SRC-138-a-cross-project-view-allows-whatever-the-viewer-ca.md)).
3. They create a task. The tool asks which project it goes in, offering only projects the actor can write to; if the view's filter allows only one project, it uses that one ([SRC-117](SRC-117-creating-a-task-in-a-cross-project-view-asks-for-i.md)).
4. In a Gantt view, they see the dependencies between the projects ([SRC-118](SRC-118-a-cross-project-gantt-draws-dependencies-between-p.md)).

## Success criteria

- The actor's changes are saved in each task's own project, and nothing done in one project changes another ([SRC-004](SRC-004-cross-project-effects-never-change-another-project.md)).

## Failure modes

- A view never grants access: two people opening the same view can see different tasks, and tasks the actor cannot read are not shown ([SRC-110](SRC-110-a-view-shows-only-the-tasks-its-viewer-can-read.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item.
