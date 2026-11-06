# TC-279: Only read-write members and admins can create a proposal

Verifies [FR-203](FR-203-let-only-read-write-members-and-admins-create-a-pr.md).

## Intent

Verify that the system refuses a proposal from someone without the read-write or admin role in a project it changes, and accepts one from a read-write member and from an admin.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob`, `carol` and `dave`, each with an access token.
- Project `Apollo` created by `alice`, who is its admin as its creator; there `bob` has the read-only role, `carol` the contributor role and `dave` the read-write role.
- Project `Zeus` created by `dave`, who is its admin; `alice` has no role there.
- Task `A` in `Apollo`, 2027-03-01, and task `Z` in `Zeus`, 2027-03-01, 1 working day each.
- The proposal P1: one group, moving `A` to start on 2027-03-08.
- The proposal P2: one group, moving `A` to start on 2027-03-08 and `Z` to start on 2027-03-09.

## Procedure

1. Through the REST API, create P1 with `bob`'s token, then with `carol`'s, then `dave`'s, then `alice`'s.
2. Through the REST API with `alice`'s token, create P2.
3. As `alice`, list `Apollo`'s proposals. As `dave`, list `Zeus`'s proposals.
4. Read `A` and `Z`.

## Expected response

- At step 1, the REST API reports `bob`'s and `carol`'s requests as refused for their role, and reports `dave`'s and `alice`'s as created, each with its new proposal.
- At step 2, the REST API reports the request as refused.
- At step 3, `Apollo` has exactly two proposals, created by `dave` and by `alice`, in that order, each holding P1's one change. `Zeus` has none.
- At step 4, `A` and `Z` still start on 2027-03-01.

## Negative assertions

- No proposal is stored from `bob` or `carol`, and none over two projects from `alice`.
- Neither `A` nor `Z` is moved by any step.

## Cleanup

Discard the test deployment.
