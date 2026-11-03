# TC-178: Anyone with an account creates a project

Verifies [FR-119](FR-119-let-anyone-with-an-account-create-a-project.md).

## Intent

Verify that anyone with an account can create a project.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`, with no role in any project or group and not a system admin.

## Procedure

1. As `erin`, create project `Erin's project`.
2. List the projects `erin` can read.

## Expected response

- The project is created and listed.

## Negative assertions

- No other project is created.

## Cleanup

Discard the test deployment.
