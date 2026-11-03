# TC-189: Cancelling a task frees its load

Verifies [FR-127](FR-127-free-a-cancelled-task-s-load.md).

## Intent

Verify that a cancelled task's load stops counting toward its assigned people.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, AI share 0%, 2027-03-01, 1 working day. No other tasks.

## Procedure

1. Read `alice`'s load on 2027-03-01; confirm 100%.
2. As `alice`, cancel `T`.
3. Read `alice`'s load on 2027-03-01 again.

## Expected response

- At step 3 `alice`'s load is 0%.

## Negative assertions

- `T` still exists, cancelled, assigned to `alice`.

## Cleanup

Discard the test deployment.
