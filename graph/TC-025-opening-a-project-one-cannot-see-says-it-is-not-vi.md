# TC-025: Opening a project one cannot see says it is not visible

Verifies [FR-017](FR-017-tell-someone-explicitly-when-a-project-is-not-visi.md).

## Intent

Verify that the system tells a person explicitly that a project is not visible to them, rather than a vague message.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has no role, directly or through a group; its address in the UI, taken from `bob`'s browser.

## Procedure

1. As `alice`, open `Borealis`'s address in the browser.

## Expected response

- The page tells `alice` that the project is not visible to her.

## Negative assertions

- The message does not say "not found", "deleted" or "no permission", alone or as alternatives.
- No data of `Borealis` is shown.

## Cleanup

Discard the test deployment.
