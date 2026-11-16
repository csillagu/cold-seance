# TC-284: A proposal is shown only to someone with a role in every project it changes

Verifies [FR-209](FR-209-show-a-proposal-only-to-someone-with-a-role-in-ev.md).

## Intent

Verify that a proposal over several projects is shown to someone with a role in each of them, read-only included, and refused as not visible to someone without a role in one of them.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob`.
- Projects `Apollo` and `Zeus`, both created by `alice`; `bob` has the read-only role in `Apollo` and no role in `Zeus`.
- Task `A` in `Apollo` and task `Z` in `Zeus`, 1 working day each.
- The proposal P1, created with `alice`'s token, moving `A` to 2027-03-08; the proposal P2, created with `alice`'s token, moving `A` to 2027-03-08 and `Z` to 2027-03-09.

## Procedure

1. As `bob`, list `Apollo`'s proposals, then read P1 and P2 through the REST API.
2. As `alice`, list `Apollo`'s proposals.

## Expected response

- At step 1, the list holds P1 only; P1 is shown; P2 is refused as not visible to `bob`.
- At step 2, the list holds P1 and P2.

## Negative assertions

- Nothing of P2 is shown to `bob`.

## Cleanup

Discard the test deployment.
