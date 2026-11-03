# TC-052: A person cannot set a weekend of their own

Verifies [FR-039](FR-039-let-each-person-maintain-their-own-working-calenda.md).

## Intent

Verify that a person's own calendar does not let them set a weekend of their own.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend; account `alice`.
- The change: `alice` tries to make Friday a weekend day in her own calendar.

## Procedure

1. As `alice`, look for a weekend setting in her own calendar in the browser.
2. Try to send the change through the REST API.
3. Read `alice`'s calendar.

## Expected response

- At step 1, no weekend setting is offered.
- At step 2, the REST API reports a rejection.

## Negative assertions

- `alice`'s calendar marks no Friday as a weekend day.
- The global calendar's weekend is still Saturday and Sunday.

## Cleanup

Discard the test deployment.
