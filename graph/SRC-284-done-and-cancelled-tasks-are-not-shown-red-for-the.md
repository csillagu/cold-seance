---
certainty: verified
source: design session
evidence: design session 2026-11-23
---

# SRC-284: Done and cancelled tasks are not shown red for their assignees' overload

A task that is done or cancelled is not shown in red when its assigned people are overloaded or on holiday on a day within it. This narrows [SRC-122](SRC-122-a-task-turns-red-when-its-assigned-people-cannot-d.md) and [SRC-170](SRC-170-a-task-turns-red-when-an-assignee-is-overloaded-or.md) for those two statuses.

As received, in the design session of 2026-11-23, recorded in issue #256 (the UI/UX review of the demo deployment). Asked, about item 11 ("Nearly every card carries the red \"The people assigned cannot do it in its time\" warning, including cards in the Done column"), "Which tasks should carry it?", with the options "Not done/cancelled" ("Done and cancelled tasks never show the warning; everything else does as today."), "Only future days count" and "Keep as is", the owner answered: "Done and cancelled should not hold."

Not stated: whether a done task still counts toward its assignees' load on the days it covers.
