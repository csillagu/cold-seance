# TC-202: A seeding import that fails partway brings nothing in

Verifies [FR-137](FR-137-seed-a-project-all-or-nothing.md).

## Intent

Verify that a seeding import that fails in any part brings nothing in.

## Inputs

- A test deployment whose access to GitHub the tester can cut off mid-request; first system admin `root`; account `alice`.
- A GitHub test repository `tc-seed` with the tool's GitHub App installed and 50 open issues; registered in the tool by `alice`; project `Apollo` created by `alice`, empty.

## Procedure

1. As `alice`, start seeding `Apollo` from `tc-seed`.
2. After the import has started and before it finishes, cut off the deployment's access to GitHub.
3. When the import reports its end, restore access and list the tasks of `Apollo`.

## Expected response

- The import reports that it failed.
- `Apollo` has no tasks.

## Negative assertions

- None of the 50 issues is recorded as already imported, so a later import of `tc-seed` is not affected by this one.

## Cleanup

Uninstall the GitHub App from `tc-seed`; discard the test deployment.
