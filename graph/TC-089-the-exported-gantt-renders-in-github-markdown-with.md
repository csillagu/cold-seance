# TC-089: The exported Gantt renders in GitHub markdown with tasks, dates, dependencies and milestones

Verifies [FR-063](FR-063-export-the-gantt-as-a-chart-that-renders-in-github.md).

## Intent

Verify that the Gantt exports as a chart that renders in GitHub markdown, carrying its tasks, dates, dependencies and milestones and leaving out load and red flags.

## Inputs

- A fresh test deployment, first system admin `root`, global calendar with Saturday and Sunday as the weekend and no company holidays.
- Account `alice`, capacity 100%; project `Apollo` created by `alice`.
- In `Apollo`: task `A` assigned to `alice`, AI share 0%, 2027-03-01, 3 working days; task `B` assigned to `alice`, AI share 0%, 2027-03-01, 1 working day (so `alice` is overloaded and both are red); task `C` blocked by `A`, 2 working days; milestone `M` blocked by `C`, pinned to 2027-03-12.
- A GitHub test repository where a markdown file can be previewed.

## Procedure

1. As `alice`, export the Gantt of `Apollo`.
2. Put the exported text in a markdown file in the GitHub repository and open GitHub's rendered view of the file.

## Expected response

- GitHub renders the export as a chart, not as plain text or an error.
- The chart shows `A` (2027-03-01 to 2027-03-03), `B` (2027-03-01), `C` (2027-03-04 to 2027-03-05), the dependencies `C` on `A` and `M` on `C`, and milestone `M` on 2027-03-12.

## Negative assertions

- The export contains no load figure for `alice` and no red flag or red marking.

## Cleanup

Delete the markdown file from the GitHub repository; discard the test deployment.
