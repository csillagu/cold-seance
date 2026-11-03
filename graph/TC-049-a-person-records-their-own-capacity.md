# TC-049: A person records their own capacity

Verifies [FR-037](FR-037-let-each-person-record-their-own-capacity.md).

## Intent

Verify that the system stores a capacity for each person and lets a person record their own.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`.
- The change: `alice` sets her own capacity to 80%.

## Procedure

1. As `alice`, make the change through the REST API.
2. Read `alice`'s capacity back as `alice`.

## Expected response

- The change succeeds.
- `alice`'s capacity is 80%.

## Negative assertions

- No other person's capacity changes.

## Cleanup

Discard the test deployment.
