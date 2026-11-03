# TC-051: A person enters many holidays in their own calendar

Verifies [FR-039](FR-039-let-each-person-maintain-their-own-working-calenda.md).

## Intent

Verify that each person has their own calendar in which they can enter as many holidays as they want.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- 30 holiday dates: every working day from 2027-03-01 to 2027-04-09.

## Procedure

1. As `alice`, enter the 30 holidays in her own calendar through the REST API.
2. Read `alice`'s calendar and `bob`'s calendar.

## Expected response

- `alice`'s calendar holds all 30 holidays.

## Negative assertions

- No entry is refused for exceeding a limit.
- `bob`'s calendar holds none of them.
- The global calendar is unchanged.

## Cleanup

Discard the test deployment.
