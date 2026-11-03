# TC-031: A red overload flag clears once the overload is gone

Verifies [FR-021](FR-021-clear-a-red-flag-once-its-conflict-is-gone.md).

## Intent

Verify that the system clears a red flag once the conflict behind it is gone.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- In `Apollo`: task `T1`, assigned to `alice`, AI share 0%, planned start 2027-03-01, duration 3 working days; task `T2`, assigned to `alice`, AI share 0%, planned start 2027-03-03, duration 1 working day. `alice` is at 200% on 2027-03-03, so `T1` and `T2` are red.
- The change: remove `alice` from `T2`'s assigned people.

## Procedure

1. As `alice`, open the Gantt of `Apollo` and confirm `T1` and `T2` are red.
2. Make the change through the REST API.
3. Reload the Gantt.

## Expected response

- At step 3, neither `T1` nor `T2` is red.

## Negative assertions

- No other change is needed for the flag to clear: neither task's dates change.

## Cleanup

Discard the test deployment.
