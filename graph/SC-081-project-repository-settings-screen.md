---
certainty: assumed
effort: 2
---

# SC-081: Project repository settings screen

The screen on which a project's admin asks to add repositories the project pulls issues from. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a project's admin can choose a repository and ask to add it to the project, and the screen then shows the outcome: the repository added at once when the admin is also its admin, or otherwise the request waiting for a repository admin's approval.

It delivers:

- [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md): Let a project set which repositories it pulls issues from
- [FR-170](FR-170-add-a-repository-at-once-when-its-adder-is-admin-o.md): Add a repository at once when its adder is admin of both it and the project

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." After its quality review in the design session of 2026-11-03 the receiving-project control was split off into SC-112. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: 2, Claude's share of the 3 the owner confirmed on 2026-11-02 ("correct"); SC-081 and SC-112 add up to it.
