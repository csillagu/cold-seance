# TC-167: The REST API reads and writes what the UI does

Verifies [FR-114](FR-114-give-the-rest-api-full-read-and-write-access-with.md).

## Intent

Verify that the REST API offers read and write access to what the UI offers.

## Inputs

- A fresh test deployment, first system admin `root`; account `alice`, with an API token; project `Apollo` created by `alice`.
- Operations through the REST API with `alice`'s token: create task `T`; set its planned start to 2027-03-01 and duration 2; save baseline `v1`; save a personal Kanban view `Board`; read the person load of `alice` for 2027-03-01; read the audit log of `Apollo`.

## Procedure

1. Run each operation in turn.
2. Open `Apollo` in the browser as `alice`.

## Expected response

- Each operation succeeds, and the browser shows `T`, `v1` and `Board` as created.

## Negative assertions

- No operation is refused for being made through the REST API.

## Cleanup

Discard the test deployment.
