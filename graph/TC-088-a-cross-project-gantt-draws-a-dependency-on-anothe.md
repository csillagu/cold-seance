# TC-088: A cross-project Gantt draws a dependency on another project's milestone

Verifies [FR-062](FR-062-draw-dependencies-between-projects-on-a-cross-proj.md).

## Intent

Verify that a Gantt covering several projects draws the dependencies between them.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice` and `bob`.
- Project `Borealis` created by `bob`, where `alice` has the read-only role, with milestone `M` on 2027-03-10.
- Project `Apollo` created by `alice`, with task `T` blocked by `M`, planned start 2027-03-11, 2 working days.
- A personal Gantt view of `alice`'s covering `Apollo` and `Borealis`.

## Procedure

1. As `alice`, open the view.

## Expected response

- `M` and `T` are both drawn, and the dependency of `T` on `M` is drawn between them.

## Negative assertions

- The dependency is not drawn in red, since `M` lies before `T`'s start.

## Cleanup

Discard the test deployment.
