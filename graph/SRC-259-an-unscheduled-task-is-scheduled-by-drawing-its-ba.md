---
certainty: verified
source: design session
evidence: design session 2026-11-16
---

# SRC-259: An unscheduled task is scheduled by drawing its bar on the Gantt

On the Gantt, an unscheduled task is given dates by drawing its bar on its empty lane: pressed and dragged either way, the bar snaps to whole days, and once let go it becomes the task's planned start and a duration of the working days it covers; the planned finish is derived from them. A fixed-date milestone with no date is placed with a click on its lane. A plain click, Escape and letting go off the lane change nothing. Only someone who can edit the task can draw it, and not on a closed task or a floating milestone.

As received, in the design session of 2026-11-16. The owner wrote, on issue #228:

> Unscheduled tasks sit at the bottom of the Gantt (FR-145) with an empty timeline lane. To give one dates today, you open the task dialog and type them. Scheduling should be as direct as in MS Project: **draw the bar where it belongs.**
>
> - **Hover** over an unscheduled task's lane: the cursor becomes a crosshair, and a faint one-day bar under the pointer previews where a bar would start.
> - **Press and drag** along the lane: a ghost bar grows from the press point to the pointer and snaps to whole days. It shows live labels for the start date, the finish date and the length in working days. Non-working days stay shaded under it, as on the rest of the Gantt.
> - **Drag either way:** dragging left from the press point works the same as dragging right. The earlier day is always the start.
> - **Release:** the bar becomes the task's planned dates. The task moves straight up into the scheduled rows, with a short transition so the eye can follow it, and stays selected.
> - **Esc** while dragging, or releasing outside the lane, cancels and changes nothing.
> - **Saving:** the bar is shown as pending until the server confirms. If the server refuses, the bar goes back and the refusal is shown, as in other Gantt edits.
>
> - Only for viewers who can edit the task (the same rule as moving a bar), and only for tasks that are not closed (see #223). For everyone else, the lane stays inert with a normal cursor.
> - Keyboard and accessibility: the task dialog remains the non-pointer way to set dates. The drawn bar must be announced, for example "Scheduled 3 Mar – 7 Mar".
>
> The ghost bar uses the regular bar style at reduced opacity, with a dashed outline while drawing. Date labels sit just above the bar and never get cut off at the edges of the viewport. The timeline auto-scrolls when the drag nears the edge. No jank: it should follow the pointer at 60 fps on a long plan.

and, under "Decisions (owner, 2026-11-16)":

> - The interaction and look and feel above are approved.
> - **A plain click** with no drag does nothing.
> - **A fixed-date milestone** without a date is placed by a click on its lane, which sets its date. A floating milestone can't be drawn: the scheduler places it.
> - **Drawing below all rows** does not create a task. Drawing works only on an existing unscheduled task's lane.
> - **What a drawn bar stores:** the planned start, plus a duration equal to the number of working days the bar covers. The planned finish is derived (FR-144) and not stored, so a holiday or calendar change added later pushes the finish out instead of shortening the work.
