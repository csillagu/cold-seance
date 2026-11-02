---
certainty: assumed
effort: 3
---

# SC-087: Repository request inbox

The screen on which a repository's admins approve or reject projects' requests to add the repository, and withdraw an approval given earlier. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It is done when a repository's admin sees each project's request to add the repository, can approve or reject it, and can withdraw an approval given earlier.

It delivers:

- [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md): Add a repository to a project only once one of its admins approves
- [FR-171](FR-171-let-a-repository-admin-reject-a-project-s-request-.md): Let a repository admin reject a project's request for the repository
- [FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md): Let a repository admin withdraw an approval given to a project

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
