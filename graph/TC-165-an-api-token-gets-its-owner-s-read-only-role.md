# TC-165: An API token gets its owner's read-only role

Verifies [FR-113](FR-113-apply-the-same-roles-to-api-tokens-and-mcp-server.md).

## Intent

Verify that REST API tokens are held to the same project roles as their owner in the UI.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- An API token created by `bob`; task `T` in `Apollo`, title `Draft`.

## Procedure

1. With `bob`'s token, read `T` through the REST API.
2. With `bob`'s token, try to change `T`'s title to `Mine`.

## Expected response

- Step 1 succeeds.
- Step 2 is rejected.

## Negative assertions

- `T`'s title is still `Draft`.

## Cleanup

Discard the test deployment.
