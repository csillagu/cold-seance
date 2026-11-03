# TC-001: A task is stored with every minimum field

Verifies [FR-001](FR-001-store-each-task-with-its-minimum-fields.md).

## Intent

Verify that the system stores a task with each of its minimum fields and returns every value as it was given.

## Inputs

- A fresh test deployment: empty database, the first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`, created by `root`.
- Project `Apollo`, created by `alice` (so `alice` is its admin); `bob` has the read-write role in it.
- Task to create in `Apollo`, through the REST API as `alice`:
  - title `Write install guide`
  - description `Steps for a fresh install`
  - planned start 2027-03-01 and duration 3 working days
  - effort `5`, in the unit the tool states for effort (the unit is not stated in the requirements)
  - AI share 0%
  - eligibility expression `alice OR bob`
  - assigned people: `alice`
  - no linked GitHub issue (the task is not assigned to a repository)

## Procedure

1. Create the task as above.
2. Read the task back through the REST API as `alice`.

## Expected response

- The create call succeeds and the task has an identifier.
- The task read back has title `Write install guide`, description `Steps for a fresh install`, project `Apollo`, a status, planned start 2027-03-01, a planned finish, effort `5`, AI share 0%, eligibility `alice OR bob` and assigned people exactly [`alice`].
- Its linked GitHub issue field is present and empty.

## Negative assertions

- No field read back differs from the value given.
- No other task is created in `Apollo`.

## Cleanup

Discard the test deployment.
