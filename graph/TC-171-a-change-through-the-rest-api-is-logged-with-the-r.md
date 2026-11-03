# TC-171: A change through the REST API is logged with the REST API channel

Verifies [FR-116](FR-116-record-every-change-in-an-audit-log.md).

## Intent

Verify that a change made through the REST API is recorded in the audit log with the REST API as its channel.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an API token; project `Apollo` created by `alice`; task `T`, title `Draft`.
- `t`: the time of the change.

## Procedure

1. With `alice`'s token, change `T`'s title to `Final` through the REST API at time `t`.
2. As `alice`, read the audit log of `Apollo`.

## Expected response

- An entry records the change, by `alice`, at `t` (to the minute), through the REST API.

## Negative assertions

- The entry does not give the UI as its channel.

## Cleanup

Discard the test deployment.
