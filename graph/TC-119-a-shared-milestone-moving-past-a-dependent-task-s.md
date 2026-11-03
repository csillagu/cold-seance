# TC-119: A shared milestone moving past a dependent task's start notifies both projects' admins

Verifies [FR-084](FR-084-notify-both-owners-when-a-shared-milestone-moves-p.md).

## Intent

Verify that, when a shared milestone moves past the start of a task that depends on it in another project, the admins of both projects are notified.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob` (admin), where `alice` has the read-only role, with milestone `M` on 2027-03-10.
- Project `Apollo` created by `alice` (admin), with task `T` blocked by `M`, planned start 2027-03-11.
- The trigger: `bob` moves `M` to 2027-03-17.

## Procedure

1. Read `alice`'s and `bob`'s in-app notifications.
2. Make the trigger.
3. Within an hour, read them again.

## Expected response

- After step 3, both `alice` and `bob` have a new notification about `M` moving past the start of `T`.

## Negative assertions

- At step 1, neither has such a notification.

## Cleanup

Discard the test deployment.
