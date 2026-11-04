# TC-268: A task's kind and a milestone's variant cannot be changed

Verifies [FR-194](FR-194-keep-a-task-s-kind-and-a-milestone-s-variant-uncha.md).

## Intent

Verify that once created, a task cannot become a milestone, a milestone cannot become a task, and a milestone cannot switch between fixed-date and floating, while a fixed-date milestone's date can still be changed.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; account `alice`; project `Apollo` created by `alice`.
- In `Apollo`: unscheduled task `Build`, not a milestone; fixed-date milestone `Launch`, pinned to 2027-03-12; floating milestone `Docs ready`.
- The rejected changes: make `Build` a milestone; make `Launch` a normal task; make `Launch` floating; make `Docs ready` fixed-date, pinned to 2027-04-01.
- The accepted change: pin `Launch` to 2027-03-19.

## Procedure

1. As `alice`, try each of the four rejected changes through the REST API.
2. As `alice`, make the accepted change through the REST API.
3. Read the three tasks as `alice`.

## Expected response

- The REST API rejects each of the four rejected changes, and accepts the accepted one.
- `Build` is a task, not a milestone.
- `Launch` is a fixed-date milestone pinned to 2027-03-19.
- `Docs ready` is a floating milestone with no date of its own.

## Negative assertions

- No task's kind, and no milestone's variant, differs from what it was created with.

## Cleanup

Discard the test deployment.
