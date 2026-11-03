# TC-242: Anyone with an account registers an unregistered repository and becomes its admin

Verifies [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md).

## Intent

Verify that anyone with an account can register a repository the GitHub App can reach that is not yet registered, and becomes its admin.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`, with no role anywhere.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed, not registered in the tool.

## Procedure

1. As `erin`, register `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- `tc-repo` is registered, with admins [`erin`].

## Negative assertions

- No project is created or changed.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
