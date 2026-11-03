# TC-181: A non-member sees every group

Verifies [FR-122](FR-122-show-every-group-to-everyone.md).

## Intent

Verify that every group is shown to everyone.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `dave`.
- Group `Platform` created by `alice`; `dave` is not a member.

## Procedure

1. As `dave`, list the groups.

## Expected response

- `Platform` is in the list.

## Negative assertions

- Seeing the group does not give `dave` any role on its projects.

## Cleanup

Discard the test deployment.
