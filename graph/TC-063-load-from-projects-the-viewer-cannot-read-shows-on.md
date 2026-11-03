# TC-063: Load from projects the viewer cannot read shows only as a percentage

Verifies [FR-046](FR-046-show-load-from-unreadable-projects-only-as-a-perce.md).

## Intent

Verify that a person's total load is shown to every viewer, with the tasks behind it for projects the viewer can read and only a percentage for the rest.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice`, `bob` and `carol`; `carol` has capacity 100%.
- Project `Apollo` created by `alice`; project `Borealis` created by `bob`, where `alice` has no role. `carol` has the read-only role in both.
- Task `Visible task` in `Apollo`, assigned to `carol`, AI share 60% (load 40%), on 2027-03-01, 1 working day.
- Task `Hidden task` in `Borealis`, assigned to `carol`, AI share 40% (load 60%), on 2027-03-01, 1 working day.

## Procedure

1. As `alice`, open the person load view and look at `carol` on 2027-03-01.

## Expected response

- `carol`'s total load on 2027-03-01 is shown as 100%.
- `Visible task` is shown by name with its 40%.
- The rest is shown as a percentage for other projects, 60%.

## Negative assertions

- The name `Hidden task`, the name `Borealis` and any other detail of `Hidden task` are not shown to `alice`.

## Cleanup

Discard the test deployment.
