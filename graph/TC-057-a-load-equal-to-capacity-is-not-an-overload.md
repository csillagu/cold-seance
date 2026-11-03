# TC-057: A load equal to capacity is not an overload

Verifies [FR-042](FR-042-mark-a-person-overloaded-on-any-day-their-load-exc.md).

## Intent

Verify that a person whose load equals their capacity is not marked as overloaded, since only a load above capacity is.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 80%; project `Apollo` created by `alice`.
- Task `T` in `Apollo`, assigned to `alice`, AI share 20% (person load 80%), planned start 2027-03-01, duration 1 working day.

## Procedure

1. As `alice`, open the person load view for 2027-03-01.

## Expected response

- `alice`'s load on 2027-03-01 is shown as 80%.

## Negative assertions

- `alice` is not shown as overloaded, nor in red, on 2027-03-01.

## Cleanup

Discard the test deployment.
