---
certainty: assumed
effort: 2
---

# SC-114: Project search bar

The search bar in the header of the frontend's layout ([SC-113](SC-113-frontend-layout.md)) in which a person searches for projects by name ([SRC-220](SRC-220-the-header-holds-a-project-search-bar.md)) and is shown only the projects they have access to. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)). The search itself is done in the service layer ([SC-116](SC-116-project-search.md)).

It is done when a person can type part of a project's name, in any case, in the header's search bar and is shown the matching projects they have access to, and no others.

It delivers:

- [FR-183](FR-183-let-a-person-search-projects-by-part-of-their-name.md): Let a person search projects by part of their name, ignoring case
- [FR-184](FR-184-return-from-a-project-search-only-the-projects-the.md): Return from a project search only the projects the person can read

Origin: split off from SC-113 by Claude for issue #15. The quality review found SC-113 bundled, and in the design session of 2026-11-03 the owner answered "yes" to splitting it. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
