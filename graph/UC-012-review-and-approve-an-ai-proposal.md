---
certainty: verified
actor: Project member with the read-write role
---

# UC-012: Review and approve an AI proposal

## Goal

Decide which of an AI's suggested changes go into the plan, after seeing what they would do.

## Preconditions

- An AI proposal is waiting for review ([SRC-079](SRC-079-a-proposal-is-a-set-of-changes-against-the-current.md)).
- The actor has the read-write role in the project the proposal changes ([SRC-080](SRC-080-a-person-with-write-access-edits-approves-or-rejec.md), [SRC-092](SRC-092-read-write-role.md)).

## Steps

1. The actor gets an in-app notification that a proposal is waiting ([SRC-015](SRC-015-notifications-for-new-red-flags-proposals-waiting.md)).
2. They open it. The proposal's changes are applied to the current plan as a preview, and the Gantt and Kanban show them as a pending overlay, with any new red flags, without touching the live plan ([SRC-014](SRC-014-gantt-and-kanban-show-ai-proposals-as-a-pending-ov.md), [DD-021](DD-021-proposal-live-preview-against-the-current-plan.md)).
3. They edit the proposal in the browser where needed ([SRC-080](SRC-080-a-person-with-write-access-edits-approves-or-rejec.md)).
4. They keep, edit or drop each group of changes as one ([DD-023](DD-023-proposal-changes-are-grouped.md)).
5. They resolve or drop any conflicts the tool shows: changes to an input someone else edited on the same task after the proposal was created, or to a task that was deleted ([DD-022](DD-022-proposal-conflicts-are-real-conflicts-only.md)).
6. They approve. All changes are applied together, and only now is the live plan overwritten ([SRC-081](SRC-081-on-approval-all-changes-are-applied-together.md), [SRC-086](SRC-086-proposal-approval-is-atomic.md)).

## Success criteria

- The approved changes are in the live plan, all together, and in the audit log ([SRC-095](SRC-095-every-change-is-recorded-in-an-audit-log.md)).

## Failure modes

- If the plan changed after the actor saw the preview, the preview refreshes and they confirm again ([SRC-086](SRC-086-proposal-approval-is-atomic.md)).
- If the preview no longer makes sense, they reject the proposal and ask the AI for a new one; nothing is rebased automatically ([SRC-087](SRC-087-stale-proposal-fallback-reject-and-ask-for-a-new-o.md)).
- They can reject the proposal outright ([SRC-080](SRC-080-a-person-with-write-access-edits-approves-or-rejec.md)).
- If the proposal spans several projects, the actor approves only their own project's part; each project's part is approved by someone with read-write access there ([DD-025](DD-025-a-proposal-may-span-several-projects-each-project.md)).
- A proposal untouched for 24 hours expires ([DD-024](DD-024-proposals-untouched-for-24-hours-expire.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item.
