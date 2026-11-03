# TC-241: A registered repository is its own item with its admins

Verifies [FR-166](FR-166-keep-each-registered-repository-as-its-own-item-wi.md).

## Intent

Verify that the system keeps each registered repository as an item of its own, separate from the projects that use it, with its admins.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- A GitHub test repository `tc-repo` with the tool's GitHub App installed; registered in the tool by `alice`.
- Projects `Apollo` (created by `alice`) and `Borealis` (created by `bob`), both pulling issues from `tc-repo`.

## Procedure

1. Read `tc-repo`'s item in the tool.
2. List the registered repositories.

## Expected response

- `tc-repo` is listed once, as its own item, with admins [`alice`].

## Negative assertions

- `bob`, admin of `Borealis`, is not one of `tc-repo`'s admins.

## Cleanup

Uninstall the GitHub App from `tc-repo`; discard the test deployment.
