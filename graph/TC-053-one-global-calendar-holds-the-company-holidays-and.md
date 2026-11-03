# TC-053: One global calendar holds the company holidays and the weekend

Verifies [FR-040](FR-040-keep-a-global-calendar-of-company-holidays-and-wee.md).

## Intent

Verify that the system keeps one global calendar holding the company holidays and the weekend, the same for everyone.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` and `bob`.
- `root` sets the weekend in the global calendar to Saturday and Sunday and adds a company holiday on 2027-03-03.

## Procedure

1. As `root`, make the settings above.
2. Read the global calendar through the REST API as `alice`, then as `bob`.

## Expected response

- Both reads return the same calendar: weekend Saturday and Sunday, company holiday 2027-03-03.

## Negative assertions

- There is no second global calendar: neither read returns a different calendar.

## Cleanup

Discard the test deployment.
