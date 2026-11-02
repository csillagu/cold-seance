---
certainty: assumed
effort: 3
---

# SC-042: Assignee availability flag detector

The function of the service layer that shows a task in red when one of its assigned people is overloaded or on holiday on a day within it, and shows a shared person's overload in red to every project involved ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).

It is done when a task shows in red for every day within it on which one of its assigned people is overloaded, as FR-042 marks it, or on holiday, and a shared person's overload shows in red in every project involved.

It delivers:

- [FR-020](FR-020-turn-a-task-red-when-its-assigned-people-cannot-do.md): Turn a task red when its assigned people cannot do it in its time
- [FR-043](FR-043-show-a-shared-person-s-overload-in-red-to-every-pr.md): Show a shared person's overload in red to every project involved

Origin: split off from SC-007, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
