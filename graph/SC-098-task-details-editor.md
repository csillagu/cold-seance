---
certainty: assumed
effort: 3
---

# SC-098: Task details editor

The editor in which a task's fields are set: title, description, duration in whole working days ([DD-006](DD-006-durations-are-whole-working-days.md)), planned dates or none, and its repository. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It delivers:

- [FR-001](FR-001-store-each-task-with-its-minimum-fields.md): Store each task with its minimum fields
- [FR-002](FR-002-take-task-durations-in-whole-working-days.md): Take task durations in whole working days
- [FR-003](FR-003-keep-a-task-without-planned-dates-as-unscheduled-i.md): Keep a task without planned dates as unscheduled in its project
- [FR-141](FR-141-let-a-task-be-assigned-to-a-repository.md): Let a task be assigned to a repository
- [FR-212](FR-212-make-a-new-task-with-a-duration-of-0-a-milestone.md): Make a new task with a duration of 0 a milestone

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.

FR-212 was added for issue #243: issue #227 built it into this editor's new-task form, which no SC delivered it from. Placing it here is Claude's reading; it awaits the owner's confirmation.
