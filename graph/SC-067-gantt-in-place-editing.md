---
certainty: assumed
effort: 5
---

# SC-067: Gantt in-place editing

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that lets the viewer edit what the Gantt shows where it is shown, within what their role in each task's project allows, and asks for the project when a task is created on a Gantt covering several.

It is done when everything the Gantt shows can be changed on the Gantt by someone whose role in the task's project allows that change, and by no one else; and creating a task on a Gantt over several projects asks for its project among those the viewer can write to, or uses the only project the view's filter allows.

It delivers:

- [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md): Make everything shown in a view editable there unless noted
- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows
- [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md): Ask for the project when a task is created in a cross-project view
- [FR-211](FR-211-resize-a-task-s-bar-on-the-gantt-by-its-ends-and-f.md): Resize a task's bar on the Gantt by its ends, and freeze a closed task's

Origin: split off from SC-031, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
