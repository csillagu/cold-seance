# TC-056: A person is marked overloaded on a day their load exceeds their capacity

Verifies [FR-042](FR-042-mark-a-person-overloaded-on-any-day-their-load-exc.md).

## Intent

Verify that a person is marked as overloaded, in red, on each day their load is above their capacity, and only on those days.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 80%; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 2 working days.

## Procedure

1. As `alice`, open the person load view for 2027-03-01 to 2027-03-05.

## Expected response

- `alice` is shown overloaded, in red, on 2027-03-01 and on 2027-03-02.

## Negative assertions

- `alice` is not shown overloaded on 2027-03-03, 2027-03-04 or 2027-03-05.

## Cleanup

Discard the test deployment.
