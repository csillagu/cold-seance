# TC-117: A notification is delivered in the app and nowhere else

Verifies [FR-082](FR-082-deliver-notifications-in-the-app-only.md).

## Intent

Verify that the system delivers its notifications in the app only, with no email, Slack or other external notification.

## Inputs

- A test deployment whose outbound network traffic is recorded; first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%, with an email address on her account if the tool stores one; project `Apollo` created by `alice` (so she is subscribed to it).
- Task `T1` in `Apollo`, assigned to `alice`, AI share 0%, 2027-03-01, 1 working day.
- The trigger: a new red flag, by creating `T2` in `Apollo`, assigned to `alice`, AI share 0%, 2027-03-01, 1 working day.

## Procedure

1. As `alice`, create `T2`.
2. As `alice`, open the notifications in the app, within an hour.
3. Inspect the recorded outbound traffic.

## Expected response

- A notification of the new red flag is in `alice`'s notifications in the app.

## Negative assertions

- The recorded traffic has no email (SMTP or mail service), Slack or other messaging traffic carrying the notification.

## Cleanup

Discard the test deployment and the recorded traffic.
