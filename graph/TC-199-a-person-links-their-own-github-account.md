# TC-199: A person links their own GitHub account

Verifies [FR-135](FR-135-let-a-person-or-a-system-admin-link-the-person-s-g.md).

## Intent

Verify that a person can link their account in the tool to their GitHub account.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with no linked GitHub account; GitHub user `tc-alice`, which the tester can sign in as.

## Procedure

1. As `alice`, link their account to `tc-alice`.
2. Read `alice`'s linked GitHub account.

## Expected response

- `alice` is linked to `tc-alice`.

## Negative assertions

- No other account in the tool is linked to `tc-alice`.

## Cleanup

Discard the test deployment.
