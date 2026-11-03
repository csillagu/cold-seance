# TC-028: A dependency turns red when the other project's milestone moves past the task's start

Verifies [FR-019](FR-019-turn-a-cross-project-dependency-red-when-the-miles.md).

## Intent

Verify that, when a milestone another project owns lies after the start of a task depending on it, the dependent project shows the dependency in red.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has the read-only role, with milestone `M` on 2027-03-10.
- Project `Apollo` created by `alice`, with task `T`, unassigned, blocked by `M`, planned start 2027-03-11, duration 2 working days.
- The change: `bob` moves `M` to 2027-03-17.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and note how the dependency of `T` on `M` is shown.
2. As `bob`, make the change.
3. As `alice`, reload the Gantt of `Apollo`.

## Expected response

- At step 1, the dependency is not red.
- At step 3, the dependency of `T` on `M` is shown in red.

## Negative assertions

- `T` still starts on 2027-03-11.

## Cleanup

Discard the test deployment.
