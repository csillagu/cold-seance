---
certainty: assumed
effort: 13
---

# SC-004: Scheduler

The project's own TypeScript scheduler in the service layer ([DD-046](DD-046-scheduling-is-the-project-s-own-code-in-the-servic.md)). It works through a project's tasks in dependency order and computes their planned dates in memory: no lag on dependencies ([DD-030](DD-030-dependencies-have-no-lag.md)), parents spanning their children, milestones on their fixed dates, forbidden days skipped, and nothing moved to fix an overload or across a project boundary ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)). The same code computes the live plan and a proposal's preview ([DD-021](DD-021-proposal-live-preview-against-the-current-plan.md)).

It delivers:

- [FR-005](FR-005-reschedule-blocked-tasks-within-a-project-when-the.md): Reschedule blocked tasks within a project when their blocker moves
- [FR-006](FR-006-make-a-parent-task-span-its-children-s-dates.md): Make a parent task span its children's dates
- [FR-007](FR-007-skip-a-task-s-non-working-days-when-scheduling-it.md): Skip a task's non-working days when scheduling it
- [FR-008](FR-008-treat-each-assigned-person-s-days-off-as-forbidden.md): Treat each assigned person's days off as forbidden dates for the task
- [FR-009](FR-009-take-forbidden-dates-from-the-global-calendar-for.md): Take forbidden dates from the global calendar for a task with no assigned people
- [FR-010](FR-010-treat-company-holidays-and-weekends-as-forbidden-d.md): Treat company holidays and weekends as forbidden dates for every task
- [FR-011](FR-011-block-moving-a-task-to-a-forbidden-date.md): Block moving a task to a forbidden date
- [FR-012](FR-012-never-move-a-milestone-from-its-fixed-date.md): Never move a milestone from its fixed date
- [FR-018](FR-018-never-change-a-project-s-plan-because-of-another-p.md): Never change a project's plan because of another project
- [FR-044](FR-044-never-move-tasks-to-fix-an-overload.md): Never move tasks to fix an overload
- [FR-144](FR-144-derive-a-task-s-planned-finish-from-its-start-and.md): Derive a task's planned finish from its start and duration
- [FR-146](FR-146-use-the-global-calendar-in-place-of-a-missing-assi.md): Use the global calendar in place of a missing assignee calendar
- [FR-148](FR-148-never-move-a-task-because-its-assigned-people-beca.md): Never move a task because its assigned people became unable to do it
- [FR-195](FR-195-place-a-floating-milestone-at-the-finish-of-what-i.md): Place a floating milestone at the finish of what it is blocked by

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect". FR-195 was added for issue #65, from the owner's description of milestones in the design session of 2026-11-04; putting it in this SC is Claude's choice and awaits the owner's confirmation.
