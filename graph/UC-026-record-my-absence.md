---
certainty: assumed
actor: Any user, for their own absences
---

# UC-026: Record my absence

## Goal

Make load reflect the days one is away.

## Steps

1. The actor enters their own absence, such as vacation or sick leave, in whole days ([SRC-129](SRC-129-each-person-records-their-own-absences.md), [SRC-042](SRC-042-absences-set-a-person-s-capacity-to-0.md), [DD-011](DD-011-availability-is-tracked-in-whole-days.md)).

## Success criteria

- The actor's capacity is 0 on the absent days, and the person load view shows any load on those days as overload ([SRC-042](SRC-042-absences-set-a-person-s-capacity-to-0.md), [SRC-011](SRC-011-person-load-view.md)).

## Failure modes

- If the absence falls inside a task the actor is assigned to, the task is not moved; it turns red ([SRC-122](SRC-122-a-task-turns-red-when-its-assigned-people-cannot-d.md), [SRC-127](SRC-127-a-change-in-availability-turns-a-task-red-without-m.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
