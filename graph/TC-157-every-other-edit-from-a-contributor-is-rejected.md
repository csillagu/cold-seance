# TC-157: Every other edit from a contributor is rejected

Verifies [FR-107](FR-107-let-a-contributor-set-only-the-status-of-tasks-ass.md).

## Intent

Verify that the system rejects every edit from a contributor other than setting the status of a task they are assigned to.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `carol`; project `Apollo` created by `alice`, where `carol` has the contributor role.
- In `Apollo`: task `Mine`, assigned to `carol`, not started, title `Mine`; task `Others`, assigned to `alice`, not started; task `Closed`, assigned to `carol`, done.
- Edits, each made by `carol`: change `Mine`'s title to `Renamed`; set `Others` to in progress; cancel `Mine`; reopen `Closed`.

## Procedure

1. Try each edit in turn through the REST API.
2. Read the three tasks.

## Expected response

- Each edit is rejected.

## Negative assertions

- `Mine` keeps its title and is not cancelled; `Others` is not started; `Closed` is still done.

## Cleanup

Discard the test deployment.
