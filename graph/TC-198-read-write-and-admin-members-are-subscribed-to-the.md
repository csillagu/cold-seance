# TC-198: Read-write and admin members are subscribed to their project automatically

Verifies [FR-134](FR-134-subscribe-read-write-and-admin-members-to-their-pr.md).

## Intent

Verify that everyone with the read-write or admin role in a project is subscribed to it automatically, and only they.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob`, `carol` and `dave`.
- Project `Apollo` created by `alice` (admin). `alice` gives `bob` the read-write role, `carol` the read-only role and `dave` the contributor role. Nobody subscribes by hand.

## Procedure

1. Read the subscriptions of `alice`, `bob`, `carol` and `dave`.

## Expected response

- `alice` and `bob` are subscribed to `Apollo`.

## Negative assertions

- `carol` and `dave` are not subscribed to `Apollo`.

## Cleanup

Discard the test deployment.
