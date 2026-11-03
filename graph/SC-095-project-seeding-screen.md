---
certainty: assumed
effort: 3
---

# SC-095: Project seeding screen

The screen on which a project's admin chooses approved repositories to seed the project from, runs the import, and sees whether it succeeded as a whole. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a project's admin can choose one or more approved repositories, start the import, and then see either that it succeeded or that it failed as a whole and brought nothing in.

It delivers:

- [FR-102](FR-102-seed-a-project-from-one-or-more-github-repositorie.md): Seed a project from one or more GitHub repositories
- [FR-137](FR-137-seed-a-project-all-or-nothing.md): Seed a project all or nothing

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
