# TC-227: There is no way to request a change in another project

Verifies [FR-155](FR-155-offer-no-cross-project-change-request-flow.md).

## Intent

Verify that the system offers no flow for one project's owners to request a change in another project.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has the read-only role, with milestone `M` on 2027-03-17.
- Project `Apollo` created by `alice`, with task `T` blocked by `M`, planned start 2027-03-11, so the dependency is red.

## Procedure

1. As `alice`, open `M`, the red dependency and `Borealis`'s views, and look for any action to ask `Borealis` to change.
2. Read `bob`'s in-app notifications.

## Expected response

- No action to request a change in `Borealis` is offered anywhere.

## Negative assertions

- `bob` has no change request from `alice`.

## Cleanup

Discard the test deployment.
