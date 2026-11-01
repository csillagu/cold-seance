---
certainty: assumed
actor: Project member with the read-write role
---

# UC-022: Cancel a task

## Goal

Take a task that is no longer wanted out of the plan.

## Preconditions

- The actor has the read-write role in the task's project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).

## Steps

1. The actor opens the task in the tool.
2. They cancel it. Tasks can be cancelled only in the tool ([DD-017](DD-017-an-issue-closed-as-not-planned-is-reopened-tasks-a.md)).

## Success criteria

- The task is cancelled.

## Failure modes

- Closing the task's issue on GitHub as "not planned" does not cancel it; see "Work on an issue from GitHub" ([DD-017](DD-017-an-issue-closed-as-not-planned-is-reopened-tasks-a.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
