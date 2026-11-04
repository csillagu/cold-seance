# TC-273: A person who loses read access stays on the task and can be removed

Verifies [FR-198](FR-198-keep-people-who-lose-read-access-in-a-task-s-eligi.md).

## Intent

Verify that a person who loses read access to a project stays in a task's eligibility and assignment, can be removed from them, and cannot be added back.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- Project `Apollo` created by `alice`; `bob` has the read-only role in it.
- Task `T` in `Apollo`, eligibility `alice OR bob`, assigned people [`bob`].
- Task `U` in `Apollo`, eligibility `alice OR bob`, assigned people [`bob`].

## Procedure

1. As `alice`, remove `bob`'s role in `Apollo`.
2. Read `T` and `U` through the REST API.
3. As `alice`, change `T`'s title to `Renamed`, and read `T`.
4. As `alice`, set `U`'s assigned people to [] and its eligibility to `alice`, and read `U`.
5. As `alice`, set `U`'s assigned people to [`bob`], then its eligibility to `alice OR bob`, and read `U`.

## Expected response

- After step 2: `T` and `U` each still have eligibility `alice OR bob` and assigned people [`bob`].
- After step 3: `T` is titled `Renamed` and still has eligibility `alice OR bob` and assigned people [`bob`].
- After step 4: `U` has eligibility `alice` and no assigned people.
- At step 5 the REST API rejects both changes; `U` still has eligibility `alice` and no assigned people.

## Negative assertions

- Removing `bob`'s role does not remove him from any task.
- `bob` gains no access to `Apollo`.

## Cleanup

Discard the test deployment.
