---
effort: 8
---

# SC-019: Repository registry

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps each registered GitHub repository as its own item with its admins, the projects that pull issues from it and their approvals, requests, rejections and withdrawals, and the one receiving project for its new issues.

It delivers:

- [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md): Let a project set which repositories it pulls issues from
- [FR-143](FR-143-mark-one-receiving-project-for-each-repository.md): Mark one receiving project for each repository
- [FR-166](FR-166-keep-each-registered-repository-as-its-own-item-wi.md): Keep each registered repository as its own item with its admins
- [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md): Let anyone with an account register an unregistered repository and become its admin
- [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md): Add a repository to a project only once one of its admins approves
- [FR-169](FR-169-let-system-admins-change-a-repository-s-admins.md): Let system admins change a repository's admins
- [FR-170](FR-170-add-a-repository-at-once-when-its-adder-is-admin-o.md): Add a repository at once when its adder is admin of both it and the project
- [FR-171](FR-171-let-a-repository-admin-reject-a-project-s-request-.md): Let a repository admin reject a project's request for the repository
- [FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md): Let a repository admin withdraw an approval given to a project
- [FR-174](FR-174-let-a-repository-s-admins-add-other-admins.md): Let a repository's admins add other admins
- [FR-175](FR-175-reject-leaving-a-repository-without-an-admin.md): Reject leaving a repository without an admin
- [FR-176](FR-176-let-a-repository-s-admins-remove-other-admins-or-s.md): Let a repository's admins remove other admins or step down

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
