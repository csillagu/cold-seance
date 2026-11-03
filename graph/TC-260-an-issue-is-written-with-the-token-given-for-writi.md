# TC-260: An issue is written with the token given for writing, beside an App given for reading

Verifies [FR-185](FR-185-call-github-for-each-function-with-the-app-or-the.md).

## Intent

Verify that, with reading issues and the Projects status field given a GitHub App and writing to issues given a personal access token, the system writes to issues with the token and still reads changes made on GitHub.

## Inputs

- A fresh test deployment whose configuration gives reading issues and the Projects status field the test GitHub App `tc-app`, and writing to issues a personal access token of GitHub account `tc-bot`; first system admin `root`; account `alice`.
- A GitHub test repository `tc-repo` with no issues, with `tc-app` installed, and which `tc-bot`'s token can write issues to; registered in the tool by `alice` and added to project `Apollo`, created by `alice`. GitHub user `tc-writer` has write access to `tc-repo`.
- Task `T` in `Apollo`, in progress, no subtasks, not blocking or blocked, not assigned to a repository.
- `D`: the date on which the test runs.

## Procedure

1. As `alice`, assign `T` to `tc-repo` through the REST API.
2. Within an hour, list the issues of `tc-repo` on GitHub.
3. As `tc-writer`, close `T`'s issue as completed.
4. Within an hour, read `T` through the REST API.

## Expected response

- After step 2, `tc-repo` has one issue for `T`, opened by `tc-bot`.
- After step 4, `T` is done, with actual finish `D`.

## Negative assertions

- The issue is not opened by `tc-app`.
- The tool does not refuse to start on its configuration.

## Cleanup

Delete the issue from `tc-repo`, uninstall `tc-app` and revoke `tc-bot`'s token; discard the test deployment.
