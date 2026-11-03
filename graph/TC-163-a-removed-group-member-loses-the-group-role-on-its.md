# TC-163: A removed group member loses the group role on its projects

Verifies [FR-111](FR-111-give-group-members-their-group-role-on-every-proje.md).

## Intent

Verify that a person holds a group's role on its projects only for as long as they are a member.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Group `Platform` created by `alice`, with `bob` as a member with the write role; project `Apollo` created by `alice` and added to `Platform`; `bob` has no direct role in `Apollo`.
- Task `T` in `Apollo`, title `Draft`.

## Procedure

1. As `alice`, remove `bob` from `Platform`.
2. As `bob`, try to change `T`'s title to `Mine` and to read `Apollo`.

## Expected response

- Both attempts are rejected, and `Apollo` is reported as not visible to `bob`.

## Negative assertions

- `T`'s title is still `Draft`.

## Cleanup

Discard the test deployment.
