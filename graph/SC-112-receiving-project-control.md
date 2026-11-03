---
certainty: assumed
effort: 1
---

# SC-112: Receiving project control

The control on a project's repository settings with which the project's admin marks the project as a repository's receiving project, or gives that role up. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)). It is done when the admin can mark the project as receiving for a repository it pulls issues from, sees the marking refused while another project holds the role, and can give the role up.

It delivers:

- [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md): Mark one receiving project for each repository
- [FR-180](FR-180-let-the-receiving-project-s-admin-give-up-receivi.md): Let the receiving project's admin give up receiving

Origin: split off from SC-081 by Claude for issue #11, after its quality review found it bundled; the owner asked Claude to make such splits on its own in the design session of 2026-11-03. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's share of SC-081's confirmed effort of 3; the parts add up to it.
