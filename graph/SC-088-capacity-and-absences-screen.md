---
certainty: assumed
effort: 2
---

# SC-088: Capacity and absences screen

The screen on which a person records their own capacity and their absences in whole days ([DD-011](DD-011-availability-is-tracked-in-whole-days.md)), and a system admin changes anyone's. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a person can set their own capacity as a percentage and record their own absences in whole days, and a system admin can do the same for anyone.

It delivers:

- [FR-037](FR-037-let-each-person-record-their-own-capacity.md): Let each person record their own capacity
- [FR-038](FR-038-let-each-person-record-their-own-absences-in-whole.md): Let each person record their own absences in whole days
- [FR-150](FR-150-let-a-system-admin-change-anyone-s-capacity-absenc.md): Let a system admin change anyone's capacity, absences and calendar

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
