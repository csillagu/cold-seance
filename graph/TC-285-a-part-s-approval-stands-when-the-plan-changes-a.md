# TC-285: A part's approval stands when the plan changes afterwards

Verifies [FR-210](FR-210-keep-a-part-s-approval-when-the-plan-changes-afte.md).

## Intent

Verify that, in a proposal over several projects, a part approved before the plan changed stays approved, and the proposal applies at the last part's approval, while an edit of the proposal withdraws the approvals given.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays; accounts `alice` (with an access token) and `bob`.
- Project `Apollo` created by `alice`, where `bob` has the read-only role, with tasks `A`, `D` (2027-03-01, 1 working day each) and `C` (2027-03-15, 1 working day); project `Borealis` created by `bob`, where `alice` has the read-write role, with tasks `B` and `E` (2027-03-01, 1 working day each).
- The proposal P1, created with `alice`'s token, moving `A` and `B` to 2027-03-08.
- The proposal P2, created with `alice`'s token, in two groups: G1 moving `D` to 2027-03-08, G2 moving `E` to 2027-03-08.

## Procedure

1. As `alice`, approve the `Apollo` part of P1 from its preview.
2. As `alice`, move `C` to 2027-03-16.
3. As `bob`, open P1's preview and approve its `Borealis` part. Read `A` and `B`.
4. As `bob`, approve the `Borealis` part of P2 from its preview. As `alice`, edit P2's G1 to move `D` to 2027-03-09 instead.
5. As `alice`, approve the `Apollo` part of P2 from a new preview. Read P2's state, `D` and `E`.

## Expected response

- At step 3, the approval applies P1: `A` and `B` both start 2027-03-08.
- At step 5, P2 has only its `Apollo` part approved; `D` and `E` still start 2027-03-01.

## Negative assertions

- `alice` is not asked to approve P1's `Apollo` part again after step 2.
- P2 applies nothing at step 5.

## Cleanup

Discard the test deployment.
