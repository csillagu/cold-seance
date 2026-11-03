# TC-170: A change in the UI is logged with who, when and the UI channel

Verifies [FR-116](FR-116-record-every-change-in-an-audit-log.md).

## Intent

Verify that a change made through the UI is recorded in the audit log with who made it, when and through which channel.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`; task `T`, title `Draft`.
- `t`: the time of the change.

## Procedure

1. As `alice`, in the browser, change `T`'s title to `Final` at time `t`.
2. As `alice`, read the audit log of `Apollo`.

## Expected response

- An entry records the change of `T`'s title, by `alice`, at `t` (to the minute), through the UI.

## Negative assertions

- The entry does not name any other channel.

## Cleanup

Discard the test deployment.
