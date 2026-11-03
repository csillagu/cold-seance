# TC-118: A new red flag notifies subscribers of its project and no one else

Verifies [FR-083](FR-083-notify-of-each-new-red-flag.md).

## Intent

Verify that, when a new red flag appears, the people subscribed to its project are notified.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` (capacity 100%), `bob` and `carol`; project `Apollo` created by `alice`; `bob` and `carol` have the read-only role.
- `bob` subscribes to `Apollo`; `carol` does not.
- Task `T1` in `Apollo`, assigned to `alice`, AI share 0%, 2027-03-01, 1 working day.
- The trigger: `alice` creates `T2`, assigned to `alice`, AI share 0%, 2027-03-01, 1 working day, so `alice` is overloaded.

## Procedure

1. Make the trigger.
2. Within an hour, read the in-app notifications of `bob` and of `carol`.

## Expected response

- `bob` has a notification of the new red flag.

## Negative assertions

- `carol` has no notification of it.

## Cleanup

Discard the test deployment.
