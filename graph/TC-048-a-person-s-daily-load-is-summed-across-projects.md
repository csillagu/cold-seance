# TC-048: A person's daily load is summed across projects

Verifies [FR-036](FR-036-sum-a-person-s-daily-load-across-all-projects.md).

## Intent

Verify that a person's load on a day is the sum of the load of all their assigned tasks active that day, across all projects.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice`, `bob` and `carol`; `carol` has capacity 100%.
- Project `Apollo` created by `alice`, project `Borealis` created by `bob`; `carol` has the read-only role in both.
- Task `T1` in `Apollo`, assigned to `carol`, AI share 50%, planned start 2027-03-01, duration 1 working day.
- Task `T2` in `Borealis`, assigned to `carol`, AI share 70%, planned start 2027-03-01, duration 1 working day.

## Procedure

1. As `carol`, read her own load on 2027-03-01 and 2027-03-02.

## Expected response

- `carol`'s load on 2027-03-01 is 80% (50% + 30%).

## Negative assertions

- `carol`'s load on 2027-03-02 is 0%.

## Cleanup

Discard the test deployment.
