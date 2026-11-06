# TC-281: A proposal holds any change to a project's tasks

Verifies [FR-205](FR-205-accept-any-change-to-a-project-s-tasks-in-a-propos.md).

## Intent

Verify that the system accepts in a proposal changes to every part of a project's tasks, not only to their dates, assignments and constraints, and refuses a change to anything else.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`; project `Apollo` created by `alice`, where `bob` has the read-only role.
- Tasks `A`, `B`, `C` and `D` in `Apollo`, not started, 1 working day each, no relations.
- The proposal: rename `A` to `A2` and change its description; set `B` in progress; cancel `C`; make `D` a subtask of `A`.
- The second proposal: give `bob` the read-write role in `Apollo`.

## Procedure

1. Through the REST API with `alice`'s token, create the proposal.
2. Read it back.
3. Through the REST API with `alice`'s token, try to create the second proposal.

## Expected response

- At step 2, the proposal holds exactly the five changes given.
- At step 3, the second proposal is refused.

## Negative assertions

- `A`, `B`, `C` and `D` are unchanged, and `bob` still has the read-only role.

## Cleanup

Discard the test deployment.
