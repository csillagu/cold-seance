# TC-162: A group member holds the group role on every project in the group

Verifies [FR-111](FR-111-give-group-members-their-group-role-on-every-proje.md).

## Intent

Verify that each member of a group holds their group role on every project in the group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`; projects `Apollo` and `Borealis` created by `alice` and added to `Platform`. `bob` has no direct role in either.
- `alice` adds `bob` to `Platform` with the write role.

## Procedure

1. As `bob`, change the title of a task in `Apollo` and of a task in `Borealis` through the REST API.

## Expected response

- Both edits are accepted.

## Negative assertions

- `bob` cannot manage members of either project, since write is not admin.

## Cleanup

Discard the test deployment.
