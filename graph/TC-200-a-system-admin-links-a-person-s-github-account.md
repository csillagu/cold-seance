# TC-200: A system admin links a person's GitHub account

Verifies [FR-135](FR-135-let-a-person-or-a-system-admin-link-the-person-s-g.md).

## Intent

Verify that a system admin can link a person's account in the tool to that person's GitHub account.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with no linked GitHub account; GitHub user `tc-alice`.

## Procedure

1. As `root`, link `alice`'s account to `tc-alice`.
2. Read `alice`'s linked GitHub account.

## Expected response

- `alice` is linked to `tc-alice`.

## Negative assertions

- `root`'s own account is not linked to `tc-alice`.

## Cleanup

Discard the test deployment.
