# TC-067: The Gantt shows the schedule, a dependency and a milestone

Verifies [FR-049](FR-049-show-the-schedule-dependencies-milestones-and-viol.md).

## Intent

Verify that the Gantt shows the schedule, the dependencies and the milestones.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: task `A` (2027-03-01, 3 working days); task `B`, blocked by `A`, 2 working days (so 2027-03-04 to 2027-03-05); milestone `M`, blocked by `B`, pinned to 2027-03-12.

## Procedure

1. As `alice`, open the Gantt of `Apollo` in the browser.

## Expected response

- `A` is drawn from 2027-03-01 to 2027-03-03 and `B` from 2027-03-04 to 2027-03-05.
- The dependency of `B` on `A` and of `M` on `B` are drawn.
- `M` is drawn as a milestone on 2027-03-12.

## Negative assertions

- No constraint violation is shown in red, since none exists.

## Cleanup

Discard the test deployment.
