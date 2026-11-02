---
certainty: assumed
effort: 1
---

# SC-017: Project creation

The function of the service layer that lets anyone with an account create a project and makes its creator its admin ([DD-035](DD-035-anyone-with-an-account-can-create-a-project-and-be.md)).

It is done when anyone with an account can create a project and its creator then holds the admin role in it.

It delivers:

- [FR-119](FR-119-let-anyone-with-an-account-create-a-project.md): Let anyone with an account create a project
- [FR-158](FR-158-make-a-project-s-creator-its-admin.md): Make a project's creator its admin

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
