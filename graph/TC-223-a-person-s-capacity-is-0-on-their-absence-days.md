# TC-223: A person's capacity is 0 on their absence days

Verifies [FR-151](FR-151-treat-a-person-s-capacity-as-0-on-their-absence-da.md).

## Intent

Verify that a person's capacity is treated as 0 on each day of their absences.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%, with an absence on 2027-03-02; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, AI-only, assigned to `alice`, person load 10%, 2027-03-01 to 2027-03-03.

## Procedure

1. As `alice`, open the person load view for 2027-03-01 to 2027-03-03.

## Expected response

- `alice`'s capacity is shown as 0% on 2027-03-02, and `alice` is shown overloaded that day.

## Negative assertions

- `alice` is not shown overloaded on 2027-03-01 or 2027-03-03.

## Cleanup

Discard the test deployment.
