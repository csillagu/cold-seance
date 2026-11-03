# TC-217: A cross-project conflict is red on a Gantt covering both projects

Verifies [FR-147](FR-147-show-a-cross-project-conflict-in-red-for-the-owner.md).

## Intent

Verify that a conflict crossing a project boundary is shown as a red violation for the owners to resolve.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has the read-only role, with milestone `M` on 2027-03-17.
- Project `Apollo` created by `alice`, where `bob` has the read-only role, with task `T` blocked by `M`, planned start 2027-03-11.
- A personal Gantt view of `alice`'s and one of `bob`'s, each covering `Apollo` and `Borealis`.

## Procedure

1. As `alice`, open their own view.
2. As `bob`, open their own view.

## Expected response

- In both views, the dependency of `T` on `M` is shown as a red violation.

## Negative assertions

- Neither `T` nor `M` has been moved to remove the conflict.

## Cleanup

Discard the test deployment.
