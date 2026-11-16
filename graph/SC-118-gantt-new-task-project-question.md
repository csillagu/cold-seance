---
certainty: assumed
effort: 2
---

# SC-118: Gantt new-task project question

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that, when a task is created on a Gantt, settles which project it goes in.

It is done when creating a task on a Gantt of one project puts it in that project, and creating one on a Gantt over several projects asks for its project among those the viewer can write to, or uses the only project the view's filter allows.

It delivers:

- [FR-061](FR-061-ask-for-the-project-when-a-task-is-created-in-a-cr.md): Ask for the project when a task is created in a cross-project view

Origin: split off from SC-067, which the quality review found bundled, at the owner's request in the design session of 2026-11-16: "Split sc067 pls". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, taken out of SC-067's 5; it awaits the owner's confirmation.
