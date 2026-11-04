---
certainty: assumed
---

# FR-194: Keep a task's kind and a milestone's variant unchanged after creation

The system must reject turning a task into a milestone, or a milestone into a task, once it is created, and reject changing a milestone between fixed-date and floating ([SRC-236](SRC-236-a-milestone-is-a-kind-of-task-fixed-date-or-floati.md)). A fixed-date milestone's date can still be changed.

It serves [UC-027](UC-027-pin-a-milestone-to-a-fixed-date.md).

Origin: composed by Claude from the items linked above, for issue #65. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. That a fixed-date milestone's date stays editable was Claude's reading, confirmed by the owner in the design session of 2026-11-04 ([SRC-236](SRC-236-a-milestone-is-a-kind-of-task-fixed-date-or-floati.md)).
