# TC-196: A person subscribes to a project

Verifies [FR-133](FR-133-let-people-subscribe-to-issues-and-projects.md).

## Intent

Verify that people can subscribe to a project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`; project `Apollo` created by `alice`, where `carol` has the read-only role and is not subscribed.

## Procedure

1. As `carol`, subscribe to `Apollo`.
2. Read `carol`'s subscriptions.

## Expected response

- `carol` is subscribed to `Apollo`.

## Negative assertions

- `carol`'s role in `Apollo` is unchanged.

## Cleanup

Discard the test deployment.
