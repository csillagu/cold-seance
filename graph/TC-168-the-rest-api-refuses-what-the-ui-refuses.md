# TC-168: The REST API refuses what the UI refuses

Verifies [FR-114](FR-114-give-the-rest-api-full-read-and-write-access-with.md).

## Intent

Verify that the REST API applies the same permission checks as the UI.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`, `carol` with an API token; project `Apollo` created by `alice`, where `carol` has the contributor role.
- Task `T` in `Apollo`, title `Draft`, assigned to `carol`.

## Procedure

1. As `carol`, in the browser, try to change `T`'s title.
2. With `carol`'s token, try the same change through the REST API.

## Expected response

- Both attempts are refused.

## Negative assertions

- `T`'s title is still `Draft`.

## Cleanup

Discard the test deployment.
