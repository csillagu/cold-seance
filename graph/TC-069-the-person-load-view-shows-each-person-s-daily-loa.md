# TC-069: The person load view shows each person's daily load across projects against capacity

Verifies [FR-051](FR-051-show-each-person-s-load-per-day-across-all-project.md).

## Intent

Verify that the person load view shows each person's load per day across all projects, measured against their capacity.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice`, `bob` and `carol`; `carol` has capacity 80%.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has the read-only role; `carol` has the read-only role in both.
- Task `T1` in `Apollo`, assigned to `carol`, AI share 50%, 2027-03-01 to 2027-03-02. Task `T2` in `Borealis`, assigned to `carol`, AI share 80%, 2027-03-02 to 2027-03-03.

## Procedure

1. As `alice`, open the person load view for 2027-03-01 to 2027-03-04 and look at `carol`.

## Expected response

- `carol`'s load is shown as 50% on 2027-03-01, 70% on 2027-03-02, 20% on 2027-03-03 and 0% on 2027-03-04.
- Each day's load is shown against `carol`'s capacity of 80%.

## Negative assertions

- No day is shown as overloaded.

## Cleanup

Discard the test deployment.
