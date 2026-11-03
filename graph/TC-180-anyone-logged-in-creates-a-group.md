# TC-180: Anyone logged in creates a group

Verifies [FR-121](FR-121-let-anyone-logged-in-create-a-group.md).

## Intent

Verify that anyone logged in can create a group.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`, with no role in any project or group and not a system admin.

## Procedure

1. As `erin`, create group `Erin's group`.
2. List the groups.

## Expected response

- The group is created and listed.

## Negative assertions

- No project is created or changed.

## Cleanup

Discard the test deployment.
