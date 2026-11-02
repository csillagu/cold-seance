---
certainty: assumed
actor: Anyone working on the issue on GitHub
---

# UC-008: Work on an issue from GitHub

## Goal

Report progress on a task from GitHub, where the work happens, without opening the tool.

## Preconditions

- The task was planned in the tool and has a linked GitHub issue ([SRC-066](SRC-066-tasks-planned-in-the-tool-create-their-github-issu.md)).
- The actor needs no role in the tool: anyone can work on the issue through GitHub ([SRC-134](SRC-134-anyone-can-work-on-a-task-s-issue-through-github.md)).

## Steps

1. The actor marks the issue as started on GitHub. The task goes to in progress and its actual start is recorded ([SRC-058](SRC-058-start-from-github.md), [DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)).
2. If the work stops, they mark it on hold. The task goes on hold ([SRC-059](SRC-059-hold-from-github.md), [DD-007](DD-007-hold-only-marks-a-task.md)).
3. They finish the work by closing the issue, or by merging a pull request that closes it. The task goes to done and its actual finish is recorded ([SRC-060](SRC-060-finish-from-github-close-issue.md), [SRC-069](SRC-069-a-merged-pr-that-closes-an-issue-counts-as-finish.md)).
4. If the work is no longer wanted, they close the issue as "not planned" instead. The task is cancelled ([SRC-171](SRC-171-cancelling-a-task-and-closing-its-issue-as-not-pla.md)).

## Success criteria

- The task's status and actual dates in the tool match what the developer did on GitHub.

## Failure modes

Each revert below leaves a short comment on the issue saying why ([SRC-070](SRC-070-every-revert-by-the-tool-leaves-a-comment-on-the-i.md)) and an in-app notification in the tool ([SRC-015](SRC-015-notifications-for-new-red-flags-proposals-waiting.md)).

- Starting a task that is still blocked is reset ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)).
- Closing a blocked issue reopens it, or recreates it if it was deleted ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)).
- Closing a parent while its children are open reopens it ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)).
- Changing the issue's planning on GitHub (assignees, sub-issues, blocked-by) is not accepted; the change is undone on GitHub ([SRC-064](SRC-064-planning-edits-made-in-github-are-not-accepted.md), [SRC-002](SRC-002-the-tool-is-the-single-source-of-truth-for-plannin.md)).
- Reopening a finished issue sets the task back to in progress and clears its actual finish ([SRC-067](SRC-067-a-finished-issue-reopened-on-github-sets-the-task.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok". Changed after that confirmation, on 2026-11-02, to follow SRC-171: step 4 was added and the failure mode for closing as "not planned" removed. The change awaits the stakeholder's confirmation.
