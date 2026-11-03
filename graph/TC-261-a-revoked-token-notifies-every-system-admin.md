# TC-261: A revoked token notifies every system admin

Verifies [FR-186](FR-186-notify-every-system-admin-when-a-personal-access-t.md).

## Intent

Verify that, when GitHub refuses a personal access token as revoked, every system admin is notified in the app, with the function the token is given for.

## Inputs

- A fresh test deployment whose configuration gives reading issues and the Projects status field the test GitHub App `tc-app`, and writing to issues a personal access token of GitHub account `tc-bot`; first system admin `root`, second system admin `sam`; account `alice`.
- A GitHub test repository `tc-repo` with no issues, with `tc-app` installed, and which `tc-bot`'s token can write issues to; registered in the tool by `alice` and added to project `Apollo`, created by `alice`.
- Task `T` in `Apollo`, not assigned to a repository.

## Procedure

1. On GitHub, as `tc-bot`, revoke the token.
2. As `alice`, assign `T` to `tc-repo` through the REST API.
3. Within an hour, read the in-app notifications of `root`, `sam` and `alice`.

## Expected response

- `root` and `sam` each have a notification that the token given for writing to issues was refused.

## Negative assertions

- `alice` has no such notification.
- No issue for `T` is opened in `tc-repo`.

## Cleanup

Uninstall `tc-app` from `tc-repo`; discard the test deployment.
