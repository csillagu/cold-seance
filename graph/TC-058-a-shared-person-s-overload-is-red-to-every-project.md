# TC-058: A shared person's overload is red to every project involved

Verifies [FR-043](FR-043-show-a-shared-person-s-overload-in-red-to-every-pr.md).

## Intent

Verify that, when a person shared between projects is overloaded, the overload is shown in red to every project involved.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Accounts `alice`, `bob` and `carol`; `carol` has capacity 100%.
- Project `Apollo` created by `alice`, project `Borealis` created by `bob`; `carol` has the read-only role in both.
- Task `T1` in `Apollo` and task `T2` in `Borealis`, each assigned to `carol`, AI share 0%, planned start 2027-03-01, duration 1 working day.

## Procedure

1. As `alice`, open the person load view of `Apollo` for 2027-03-01.
2. As `bob`, open the person load view of `Borealis` for 2027-03-01.

## Expected response

- In both views, `carol` is shown overloaded, in red, on 2027-03-01.

## Negative assertions

- Neither `T1` nor `T2` has moved.

## Cleanup

Discard the test deployment.
