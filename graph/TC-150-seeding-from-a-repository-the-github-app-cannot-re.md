# TC-150: Seeding from a repository the GitHub App cannot reach is refused

Verifies [FR-102](FR-102-seed-a-project-from-one-or-more-github-repositorie.md).

## Intent

Verify that a project can be seeded only from repositories whose admin has given the tool access.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`, empty.
- A GitHub test repository `tc-closed` with one open issue, on which the tool's GitHub App is not installed.

## Procedure

1. As `alice`, try to seed `Apollo` from `tc-closed`.
2. List the tasks of `Apollo`.

## Expected response

- The seeding is refused, or `tc-closed` is not offered.

## Negative assertions

- `Apollo` has no tasks.

## Cleanup

Discard the test deployment.
