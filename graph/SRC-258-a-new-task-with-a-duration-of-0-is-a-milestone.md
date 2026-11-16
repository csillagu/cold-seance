---
certainty: verified
source: design session
evidence: design session 2026-11-16
---

# SRC-258: A new task with a duration of 0 is a milestone

When a task is made, giving it a duration of 0 makes it a milestone ([SRC-236](SRC-236-a-milestone-is-a-kind-of-task-fixed-date-or-floati.md)). There is no separate choice of kind: a milestone given a date is pinned to that date, and one given none is floating. The fields a milestone cannot have are not offered once its duration is 0.

As received, in the design session of 2026-11-16, asking for issue #227 ("Milestones can't be created in the UI") to be implemented: "A 0 long task should be a milestone"

Then, asked how that should work in the two new-task forms, the owner chose, of three options, "Duration 0 = milestone", described as: "No separate kind choice. Entering duration 0 makes it a milestone: a planned date makes it fixed-date, no date makes it floating. Effort, AI share and assignees are hidden at 0." The options not chosen were keeping the issue's choice of task, fixed-date milestone or floating milestone and switching it to a milestone at duration 0, and keeping that choice and refusing a duration of 0.
