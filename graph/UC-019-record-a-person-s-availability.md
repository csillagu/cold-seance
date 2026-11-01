# UC-019: Record a person's availability

## Goal

Make load and scheduling reflect when a person can actually work.

The actor is not stated in the input: who records a person's capacity, absences and calendar is still open.

## Steps

1. The actor sets the person's capacity, for example 100% full-time or 80% part-time ([SRC-041](SRC-041-each-person-has-a-capacity.md)).
2. They enter the person's absences, such as vacation or sick leave, in whole days ([SRC-042](SRC-042-absences-set-a-person-s-capacity-to-0.md), [DD-011](DD-011-availability-is-tracked-in-whole-days.md)).
3. Where the person follows different holidays, for example another country's, they give the person their own calendar, which overrides the shared one ([SRC-045](SRC-045-per-person-calendars-can-override-the-shared-calen.md)).

## Success criteria

- The person load view measures the person's load against the new capacity, with capacity 0 on absent days ([SRC-041](SRC-041-each-person-has-a-capacity.md), [SRC-042](SRC-042-absences-set-a-person-s-capacity-to-0.md), [SRC-011](SRC-011-person-load-view.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
