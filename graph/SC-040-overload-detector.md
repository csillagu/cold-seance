---
certainty: assumed
effort: 2
---

# SC-040: Overload detector

The function of the service layer that marks a person as overloaded on each day their load is above their capacity, and never moves a task because of it ([DD-029](DD-029-overloads-and-cross-project-conflicts-are-shown-in.md)).

It delivers:

- [FR-042](FR-042-mark-a-person-overloaded-on-any-day-their-load-exc.md): Mark a person overloaded on any day their load exceeds their capacity

Origin: split off from SC-006, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
