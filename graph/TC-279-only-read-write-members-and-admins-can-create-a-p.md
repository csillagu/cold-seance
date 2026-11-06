# TC-279: Only read-write members and admins can create a proposal

Verifies [FR-203](FR-203-let-only-read-write-members-and-admins-create-a-pr.md).

## Intent

Verify that the system refuses a proposal from someone without the read-write or admin role in a project it changes, and accepts one from a read-write member and from an admin.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice`, `bob`, `carol` and `dave`, each with an access token; project `Apollo` created by `alice`, where `bob` has the read-only role, `carol` the contributor role and `dave` the read-write role; project `Zeus` created by `dave`, where `alice` has no role.
- Task `A` in `Apollo` and task `Z` in `Zeus`, 1 working day each.
- The proposal: move `A` to start on 2027-03-08.
- The proposal over two projects: move `A` to start on 2027-03-08 and `Z` to start on 2027-03-09.

## Procedure

1. Through the REST API with each of `bob`'s, `carol`'s, `dave`'s and `alice`'s tokens, create the proposal.
2. Through the REST API with `alice`'s token, create the proposal over two projects.
3. As `alice`, list `Apollo`'s proposals.

## Expected response

- At step 1, `bob`'s and `carol`'s are refused; `dave`'s and `alice`'s are created.
- At step 2, the proposal is refused.
- At step 3, there are exactly two proposals, `dave`'s and `alice`'s.

## Negative assertions

- No proposal is stored from `bob`, from `carol`, or over two projects from `alice`.

## Cleanup

Discard the test deployment.
