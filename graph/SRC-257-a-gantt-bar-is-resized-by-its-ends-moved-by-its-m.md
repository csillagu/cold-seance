---
certainty: verified
source: design session
evidence: design session 2026-11-16
---

# SRC-257: A Gantt bar is resized by its ends, moved by its middle; a closed task is frozen

On the Gantt, a bar's left or right end is grabbed to move only that end, and its middle to move the whole bar without changing its length. Moving the right end changes the task's duration; moving the left end changes its start and its duration so that the finish stays; moving the middle changes the start and keeps the duration. A done or cancelled task cannot be moved or resized there. Parents and floating milestones stay fixed, and a milestone is only moved, never resized.

As received, in the design session of 2026-11-16. The owner wrote, on issue #223:

> - **Grab the left or right end of a bar:** the cursor becomes a left-right resize arrow (`ew-resize`), and only the grabbed end moves. Left end: the start changes and the finish stays. Right end: the finish changes and the start stays.
> - **Grab the middle of a bar:** the hand cursor, as now, and the whole bar moves. The length doesn't change.
> - **All of this is allowed whenever the task is not closed.** A done (closed) task is frozen: no move, no resize, and no grab or resize cursor.

and, under "Decided (owner, 2026-11-16)":

> a bar stores its planned start and a duration in working days. The planned finish is derived (FR-144). So:
> - **Resizing the right end** changes the duration.
> - **Resizing the left end** changes the start and the duration, so that the finish stays put.
> - **Moving the middle** changes the start and keeps the duration.

Asked, in the session that implemented the issue, "Parents and floating milestones get their dates from the scheduler. Should their bars become draggable on the Gantt, or stay fixed?", the owner chose "Stay fixed". Asked "Should a milestone bar only move and never resize?", the owner chose "Move only". Asked "Does 'closed' mean done only, or done and cancelled?", the owner chose "Done and cancelled".
