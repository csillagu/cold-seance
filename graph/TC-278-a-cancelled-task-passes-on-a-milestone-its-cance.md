# TC-278: A cancelled task passes on a milestone its canceller cannot read

Verifies [FR-128](FR-128-pass-a-cancelled-task-s-blockers-on-to-the-tasks-i.md).

## Intent

Verify that, when a task blocked by another project's milestone is cancelled, the tasks it blocked become blocked by that milestone, even if the person cancelling cannot read the milestone's project.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has the read-write role; project `Hermes` created by `alice`, where `bob` has no role.
- In `Hermes`: floating milestone `N`.
- In `Apollo`: task `B`, blocked by `N`; task `C`, blocked by `B`. All unscheduled and not started.

## Procedure

1. As `bob`, cancel `B` through the REST API.
2. As `alice`, read `C`'s blocked-by relations.

## Expected response

- The cancel call succeeds.
- `C` is blocked by `N`.

## Negative assertions

- `C` is no longer blocked by `B`.

## Cleanup

Discard the test deployment.
