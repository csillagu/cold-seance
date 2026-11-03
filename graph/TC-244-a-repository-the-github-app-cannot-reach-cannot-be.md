# TC-244: A repository the GitHub App cannot reach cannot be registered

Verifies [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md).

## Intent

Verify that only a repository the GitHub App has access to can be registered.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`.
- A GitHub test repository `tc-closed`, on which the tool's GitHub App is not installed.

## Procedure

1. As `erin`, try to register `tc-closed`.
2. List the registered repositories.

## Expected response

- The attempt is rejected, or `tc-closed` is not offered.

## Negative assertions

- `tc-closed` is not registered.

## Cleanup

Discard the test deployment.
