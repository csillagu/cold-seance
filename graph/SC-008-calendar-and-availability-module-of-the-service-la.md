---
certainty: assumed
effort: 5
---

# SC-008: Calendar and availability module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps the global calendar of company holidays and weekend days, each person's own calendar of holidays, their capacity, and their absences in whole days ([DD-011](DD-011-availability-is-tracked-in-whole-days.md)).

It delivers:

- [FR-037](FR-037-let-each-person-record-their-own-capacity.md): Let each person record their own capacity
- [FR-038](FR-038-let-each-person-record-their-own-absences-in-whole.md): Let each person record their own absences in whole days
- [FR-039](FR-039-let-each-person-maintain-their-own-working-calenda.md): Let each person maintain their own working calendar
- [FR-040](FR-040-keep-a-global-calendar-of-company-holidays-and-wee.md): Keep a global calendar of company holidays and weekends
- [FR-041](FR-041-let-system-admins-manage-the-company-holidays.md): Let system admins manage the company holidays
- [FR-131](FR-131-let-the-weekend-days-be-set-in-the-global-calendar.md): Let the weekend days be set in the global calendar
- [FR-150](FR-150-let-a-system-admin-change-anyone-s-capacity-absenc.md): Let a system admin change anyone's capacity, absences and calendar

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
