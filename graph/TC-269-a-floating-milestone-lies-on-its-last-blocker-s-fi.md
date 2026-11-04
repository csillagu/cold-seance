# TC-269: A floating milestone lies on its last blocker's finish

Verifies [FR-195](FR-195-place-a-floating-milestone-at-the-finish-of-what-i.md).

## Intent

Verify that scheduling places a floating milestone on the date the last of the tasks it is blocked by finishes, and on no date while none of them has dates.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unassigned tasks `A`, planned start 2027-03-01 (a Monday) with a duration of 3 working days, and `B`, planned start 2027-03-01 with a duration of 5 working days; and unscheduled, unassigned task `C`.
- Floating milestone `Ready`, blocked by `A` and `B`; floating milestone `Later`, blocked by `C` only.

## Procedure

1. Read `Ready` and `Later` through the REST API as `alice`.

## Expected response

- `Ready` lies on 2027-03-05, the day `B` finishes, which is the later of `A`'s finish (2027-03-03) and `B`'s finish.
- `Later` has no date.

## Negative assertions

- `Ready` does not lie on 2027-03-08, the next working day after `B`'s finish, nor on 2027-03-03.
- `Ready` spans no more than one date.

## Cleanup

Discard the test deployment.
