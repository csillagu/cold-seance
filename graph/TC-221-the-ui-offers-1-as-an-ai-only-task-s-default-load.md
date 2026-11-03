# TC-221: The UI offers 1% as an AI-only task's default load

Verifies [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md).

## Intent

Verify that the UI offers 1% as the default person-load percentage for an AI-only task.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.

## Procedure

1. As `alice`, in the browser, start creating a task in `Apollo` and set its AI share to 100%.
2. Look at the person-load percentage field before typing in it.

## Expected response

- The field offers 1%.

## Negative assertions

- The field does not offer 0% or 100%.

## Cleanup

Discard the test deployment.
