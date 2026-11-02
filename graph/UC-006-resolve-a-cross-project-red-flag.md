---
certainty: assumed
actor: Owner of a project involved in the conflict
---

# UC-006: Resolve a cross-project red flag

## Goal

Notice and settle a conflict that crosses a project boundary, without the tool changing anyone else's plan.

## Preconditions

- A shared milestone has moved past the start of a task that depends on it in another project ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md)), or a person shared between projects is overloaded ([SRC-047](SRC-047-an-overload-is-shown-in-red-to-every-project-invol.md)).

## Steps

1. The actor gets an in-app notification of the new red flag ([SRC-015](SRC-015-notifications-for-new-red-flags-proposals-waiting.md), [SRC-050](SRC-050-both-owners-get-an-in-app-notification.md), [DD-003](DD-003-notifications-are-in-app-only.md)).
2. They open it and see the conflict in red in their own project: the broken dependency on the Gantt, or the overload in the person load view ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md), [SRC-047](SRC-047-an-overload-is-shown-in-red-to-every-project-invol.md), [DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).
3. They change their own project's plan to remove the conflict, for example by moving their own task or assigning someone else.

## Success criteria

- The red flag clears once the conflict is gone.

## Failure modes

- The tool never fixes the conflict by changing another project's plan, and does not level loads automatically across projects ([SRC-004](SRC-004-cross-project-effects-never-change-another-project.md), [DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).
- If the conflict can only be fixed in the other project, the tool offers no way to request that change in v1; the owners get the in-app notification only ([DD-012](DD-012-no-cross-project-change-request-flow-in-v1.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
