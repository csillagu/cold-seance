---
certainty: assumed
effort: 3
---

# SC-067: Gantt in-place editing

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that lets the viewer edit what the Gantt shows where it is shown, within what their role in each task's project allows.

It is done when everything the Gantt shows can be changed on the Gantt by someone whose role in the task's project allows that change, and by no one else.

It delivers:

- [FR-053](FR-053-make-everything-shown-in-a-view-editable-there-unl.md): Make everything shown in a view editable there unless noted
- [FR-060](FR-060-allow-on-each-card-in-a-cross-project-view-what-th.md): Allow on each card in a cross-project view what the viewer's role there allows

Origin: split off from SC-031, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.

Split again, as the quality review found it bundled, at the owner's request in the design session of 2026-11-16: "Split sc067 pls". Asking for a new task's project went to [SC-118](SC-118-gantt-new-task-project-question.md), and resizing and drawing bars to [SC-119](SC-119-gantt-bar-resizing-and-drawing.md). The boundaries are Claude's, and so is lowering the effort from 5 to 3, for the 2 SC-118 takes; both await the owner's confirmation.
