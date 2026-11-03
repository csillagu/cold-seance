# TC-082: A group view filtered on the viewer shows each viewer their own tasks

Verifies [FR-058](FR-058-let-a-saved-view-filter-on-the-person-viewing-it.md).

## Intent

Verify that a saved view's filter can refer to the person viewing it, also in a view kept in a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`, with `bob` as a member with the write role; project `Apollo` created by `alice`, added to `Platform`.
- Tasks in `Apollo`: `A-task` assigned to [`alice`], `B-task` assigned to [`bob`].
- A Kanban view `MY kanban`, kept in `Platform`, filtered on assigned people containing the person viewing it.

## Procedure

1. As `alice`, open `MY kanban`.
2. As `bob`, open `MY kanban`.

## Expected response

- `alice` sees `A-task` only.
- `bob` sees `B-task` only.

## Negative assertions

- The saved filter is the same for both: neither opening changes it.

## Cleanup

Discard the test deployment.
