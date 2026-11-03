# TC-038: Two-level AND/OR eligibility expressions are stored as given

Verifies [FR-028](FR-028-store-eligibility-as-an-and-or-expression-up-to-tw.md).

## Intent

Verify that the system stores a task's eligibility as an AND/OR expression over people, two levels deep, in both nesting orders.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob`, `carol` and `dave`.
- Project `Apollo` created by `alice`; `bob`, `carol` and `dave` have the read-only role in it.
- Task `T1` in `Apollo`, eligibility `alice AND (bob OR carol OR dave)`.
- Task `T2` in `Apollo`, eligibility `(alice AND bob) OR carol`.

## Procedure

1. As `alice`, create `T1` and `T2` through the REST API.
2. Read both back.

## Expected response

- `T1`'s eligibility is `alice AND (bob OR carol OR dave)`.
- `T2`'s eligibility is `(alice AND bob) OR carol`.

## Negative assertions

- Neither expression is flattened or regrouped into a different logical meaning.
- Neither task has assigned people as a result.

Not stated: what happens to an expression three levels deep; this test does not cover it.

## Cleanup

Discard the test deployment.
