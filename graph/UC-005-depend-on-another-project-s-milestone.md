---
certainty: assumed
actor: Project member with the read-write role in the dependent project
---

# UC-005: Depend on another project's milestone

## Goal

Make a task wait for a milestone that another project owns.

## Preconditions

- The actor has the read-write role in their own project ([SRC-092](SRC-092-read-write-role.md), [DD-034](DD-034-roles-are-assigned-per-project.md)).
- The milestone belongs to another project ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md)).

## Steps

1. The actor opens the task in their own project.
2. They mark it blocked by the other project's milestone ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md)).
3. They save.
4. A Gantt view that covers both projects draws the dependency between them ([SRC-118](SRC-118-a-cross-project-gantt-draws-dependencies-between-p.md)).

## Success criteria

- The task is recorded as blocked by the milestone, and the dependency shows on a Gantt that covers both projects ([SRC-118](SRC-118-a-cross-project-gantt-draws-dependencies-between-p.md)).

## Failure modes

- If the actor cannot read the other project, they cannot depend on its milestone ([SRC-049](SRC-049-depending-on-another-project-s-milestone-requires.md)); the tool says explicitly that the project is not visible to them, rather than a vague message ([SRC-119](SRC-119-a-project-someone-cannot-see-is-reported-as-not-vi.md)).
- If the milestone lies after the task's start, the dependency is red in the actor's project; the task's dates are not moved ([SRC-048](SRC-048-shared-milestones-one-owning-project-others-can-de.md)).
- Later moves of the milestone never move the dependent task; see "Resolve a cross-project red flag" ([SRC-004](SRC-004-cross-project-effects-never-change-another-project.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
