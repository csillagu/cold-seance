# TC-231: A group's creator becomes its admin

Verifies [FR-159](FR-159-make-a-group-s-creator-its-admin.md).

## Intent

Verify that whoever creates a group becomes its admin.

## Inputs

- A fresh test deployment, first system admin `root`; account `erin`, with no role anywhere.

## Procedure

1. As `erin`, create group `Erin's group`.
2. Read `erin`'s role in it.

## Expected response

- `erin` is a member of `Erin's group` with the admin role.

## Negative assertions

- The group has no other member.

## Cleanup

Discard the test deployment.
