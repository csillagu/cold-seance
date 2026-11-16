---
certainty: assumed
effort: 3
---

# SC-119: Gantt bar resizing and drawing

The part of the Gantt component ([DD-042](DD-042-the-gantt-and-kanban-views-are-implemented-from-sc.md), [DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)) that changes a task's dates through the shape of its bar: an end of a bar dragged to make it longer or shorter, the bars of closed tasks kept frozen, and an unscheduled task's bar drawn on its empty lane.

It is done when dragging an end of a task's bar moves only that end and changes the task's start and duration as FR-211 says, a done or cancelled task's bar can be neither moved nor resized, and an unscheduled task can be given dates by drawing its bar on its lane as FR-213 says.

It delivers:

- [FR-211](FR-211-resize-a-task-s-bar-on-the-gantt-by-its-ends-and-f.md): Resize a task's bar on the Gantt by its ends, and freeze a closed task's
- [FR-213](FR-213-schedule-an-unscheduled-task-by-drawing-its-bar-on.md): Schedule an unscheduled task by drawing its bar on the Gantt

Origin: split off from SC-067, which the quality review found bundled, at the owner's request in the design session of 2026-11-16: "Split sc067 pls". The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for the work of issues #223 and #228, which SC-067's estimate did not include; it awaits the owner's confirmation.
