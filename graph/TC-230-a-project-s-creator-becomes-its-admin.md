# TC-230: A project's creator becomes its admin

Verifies [FR-158](FR-158-make-a-project-s-creator-its-admin.md).

## Intent

Verify that whoever creates a project becomes its admin.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`, with no role anywhere.

## Procedure

1. As `erin`, create project `Erin's project`.
2. Read `erin`'s role in it.

## Expected response

- `erin` is admin of `Erin's project`.

## Negative assertions

- `root` is given no role in it.

## Cleanup

Discard the test deployment.
