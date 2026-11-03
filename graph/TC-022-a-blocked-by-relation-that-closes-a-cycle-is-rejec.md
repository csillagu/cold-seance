# TC-022: A blocked-by relation that closes a cycle is rejected

Verifies [FR-014](FR-014-reject-a-blocked-by-relation-that-would-create-a-c.md).

## Intent

Verify that the system rejects, when it is saved, a blocked-by relation that would create a cycle.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, unscheduled tasks `A`, `B` and `C`, with `A` blocked by `B` and `B` blocked by `C`.
- The change: make `C` blocked by `A`.

## Procedure

1. As `alice`, save the change through the REST API.
2. Read the blocked-by relations of `A`, `B` and `C`.

## Expected response

- The REST API reports that the relation was rejected.
- The relations are exactly `A` blocked by `B` and `B` blocked by `C`.

## Negative assertions

- `C` is not blocked by `A`.
- No other relation is added or removed.

## Cleanup

Discard the test deployment.
