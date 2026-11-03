# TC-258: A repository admin steps down while another admin remains

Verifies [FR-176](FR-176-let-a-repository-s-admins-remove-other-admins-or-s.md).

## Intent

Verify that an admin of a repository can step down when another admin remains.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`, with `bob` also its admin.

## Procedure

1. As `alice`, step down as admin of `tc-repo`.
2. Read `tc-repo`'s admins.

## Expected response

- The admins are [`bob`].

## Negative assertions

- `bob` is unchanged as admin.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
