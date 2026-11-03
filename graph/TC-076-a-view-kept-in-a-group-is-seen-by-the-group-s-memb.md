# TC-076: A view kept in a group is seen by the group's members

Verifies [FR-055](FR-055-keep-a-saved-view-in-a-project-a-group-or-personal.md).

## Intent

Verify that a saved view kept in a group is seen by the group's members, and not by people outside the group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob` and `dave`.
- Group `Platform` created by `alice`, with `bob` added as a member with the read role; `dave` is not a member.
- Project `Apollo` created by `alice` and added to `Platform`; `dave` has the read-only role in `Apollo` directly.
- A Kanban view `Platform board`, kept in group `Platform`, covering `Apollo`, saved by `alice`.

## Procedure

1. As `bob`, list the saved views they can see.
2. As `dave`, list the saved views they can see.

## Expected response

- `Platform board` is in `bob`'s list.

## Negative assertions

- `Platform board` is not in `dave`'s list, although `dave` can read `Apollo`.

## Cleanup

Discard the test deployment.
