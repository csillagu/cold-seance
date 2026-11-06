# TC-281: A proposal holds any change to a project's tasks

Verifies [FR-205](FR-205-accept-any-change-to-a-project-s-tasks-in-a-propos.md).

## Intent

Verify that the system accepts in a proposal changes to every part of a project's tasks, not only to their dates, assignments and constraints.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an access token; project `Apollo` created by `alice`.
- Tasks `A`, `B`, `C` and `D` in `Apollo`, not started, 1 working day each, no relations, no description.
- The proposal, one group of five changes, in this order:
  1. `A`'s title set to `A2`;
  2. `A`'s description set to `Now A2`;
  3. `B`'s status set to in progress;
  4. `C` cancelled;
  5. `D` made a subtask of `A`.

## Procedure

1. Through the REST API with `alice`'s token, create the proposal.
2. Read it back through the REST API.
3. Read `A`, `B`, `C` and `D`.

## Expected response

- At step 1, the proposal is reported created.
- At step 2, it holds one group of exactly the five changes, in the order given, each naming its task and what it sets as given.

## Negative assertions

- At step 3, `A` is still titled `A` with no description, `B` is not started, `C` is not cancelled, and `D` is a subtask of nothing.

## Cleanup

Discard the test deployment.
