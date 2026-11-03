# TC-122: Notifications can be read through the REST API

Verifies [FR-087](FR-087-let-the-rest-api-and-the-mcp-server-read-notificat.md).

## Intent

Verify that a person's notifications can be read through the REST API.

## Inputs

- A fresh test deployment, first system admin `root`; accounts `alice` (with an access token) and `bob` (with an access token).
- Project `Apollo` created by `alice`, where `bob` has the read-write role; task `A` in `Apollo`.
- A proposal created through the MCP server with `alice`'s token, moving `A`, so `bob` has an in-app notification that it is waiting for review.

## Procedure

1. As `bob`, read their notifications in the app.
2. Read `bob`'s notifications through the REST API with `bob`'s token.

## Expected response

- The REST API returns the same notification as the app, about the proposal waiting for review.

## Negative assertions

- Reading through the REST API does not delete the notification from the app.

## Cleanup

Discard the test deployment.
