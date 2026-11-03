# TC-182: Anyone adds a new project to a group

Verifies [FR-123](FR-123-let-anyone-add-a-new-project-to-a-group-and-only-i.md).

## Intent

Verify that anyone can add a new project to a group.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `dave`.
- Group `Platform` created by `alice`; `dave` is not a member.

## Procedure

1. As `dave`, create project `Delta` and add it to `Platform`.
2. List `Platform`'s projects.

## Expected response

- `Delta` is in `Platform`.

## Negative assertions

- `dave` does not become a member of `Platform`.

## Cleanup

Discard the test deployment.
