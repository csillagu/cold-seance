# TC-179: Creating a project with a name already used is rejected

Verifies [FR-120](FR-120-reject-a-project-name-that-is-already-used.md).

## Intent

Verify that the system rejects creating a project whose name another project already has.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`; project `Apollo` created by `alice`, where `bob` has no role.

## Procedure

1. As `bob`, try to create a project named `Apollo`.
2. As `root`, list all projects.

## Expected response

- The creation is rejected.
- There is exactly one project named `Apollo`, created by `alice`.

## Negative assertions

- `bob` is not made admin of any project.

Not stated: whether names differing only in letter case count as the same; this test does not cover it.

## Cleanup

Discard the test deployment.
