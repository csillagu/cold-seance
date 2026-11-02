---
certainty: assumed
effort: 3
---

# SC-081: Project repository settings screen

The screen on which a project's admin asks to add repositories the project pulls issues from and marks the project as a repository's receiving project. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a project's admin can ask to add a repository to the project, which is added at once when they are also its admin, and can mark the project as the receiving project of a repository it pulls issues from.

It delivers:

- [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md): Let a project set which repositories it pulls issues from
- [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md): Mark one receiving project for each repository
- [FR-170](FR-170-add-a-repository-at-once-when-its-adder-is-admin-o.md): Add a repository at once when its adder is admin of both it and the project

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
