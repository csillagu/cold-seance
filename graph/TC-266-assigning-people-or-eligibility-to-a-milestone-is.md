# TC-266: Assigning people or eligibility to a milestone is rejected

Verifies [FR-192](FR-192-reject-assignees-and-an-eligibility-expression-on.md).

## Intent

Verify that a milestone can have neither assigned people nor an eligibility expression.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- Account `bob`, with the read-write role in `Apollo`.
- In `Apollo`, fixed-date milestone `Launch`, pinned to 2027-03-12, with no assigned people and no eligibility expression.
- The changes: assign `bob` to `Launch`; give `Launch` the eligibility expression `alice OR bob`.

## Procedure

1. As `alice`, try each change through the REST API.
2. Read `Launch` as `alice`.

## Expected response

- The REST API rejects both changes.
- `Launch` has no assigned people and no eligibility expression.

## Negative assertions

- `bob` is not assigned to `Launch`.
- No eligibility expression is stored for `Launch`.

## Cleanup

Discard the test deployment.
