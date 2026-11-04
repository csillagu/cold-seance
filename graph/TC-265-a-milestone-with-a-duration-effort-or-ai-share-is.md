# TC-265: A milestone with a duration, effort or AI share is rejected

Verifies [FR-191](FR-191-keep-a-milestone-without-duration-effort-or-ai-sha.md).

## Intent

Verify that a milestone takes no time and carries no duration, effort or AI share: each is rejected, whether given when the milestone is created or added later.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`, fixed-date milestone `Launch`, pinned to 2027-03-12.
- Three milestones to create in `Apollo`, each fixed-date and pinned to 2027-04-01: one with a duration of 2 working days, one with effort `3`, one with AI share 50%.
- Three edits of `Launch`: set its duration to 2 working days; set its effort to `3`; set its AI share to 50%.

## Procedure

1. As `alice`, try each of the three creations through the REST API.
2. As `alice`, try each of the three edits of `Launch` through the REST API.
3. List `Apollo`'s tasks and read `Launch` as `alice`.

## Expected response

- The REST API rejects each of the six requests.
- `Apollo`'s only task is `Launch`: pinned to 2027-03-12, with no duration, no effort and no AI share, and with no date other than 2027-03-12.

## Negative assertions

- No milestone pinned to 2027-04-01 is created.
- `Launch` does not gain a duration, effort or AI share, and its date does not change.

## Cleanup

Discard the test deployment.
