# TC-243: Registering an already registered repository is rejected

Verifies [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md).

## Intent

Verify that the system rejects registering a repository that is already registered.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, registered in the tool by `alice`.

## Procedure

1. As `bob`, try to register `tc-repo`.
2. Read `tc-repo`'s admins and the list of registered repositories.

## Expected response

- The attempt is rejected.
- `tc-repo` is listed once, with admins [`alice`].

## Negative assertions

- `bob` is not an admin of `tc-repo`.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
