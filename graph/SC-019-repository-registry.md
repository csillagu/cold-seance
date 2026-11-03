---
certainty: assumed
effort: 3
---

# SC-019: Repository registry

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps each registered GitHub repository as its own item with its admins: registering a repository, adding and removing its admins, and never leaving it without one. It is done when a repository can be registered by anyone with an account, its admins can be changed by its admins and by system admins, and a change that would leave it without an admin is rejected.

It delivers:

- [FR-166](FR-166-keep-each-registered-repository-as-its-own-item-wi.md): Keep each registered repository as its own item with its admins
- [FR-167](FR-167-let-anyone-with-an-account-register-an-unregistere.md): Let anyone with an account register an unregistered repository and become its admin
- [FR-169](FR-169-let-system-admins-change-a-repository-s-admins.md): Let system admins change a repository's admins
- [FR-174](FR-174-let-a-repository-s-admins-add-other-admins.md): Let a repository's admins add other admins
- [FR-175](FR-175-reject-leaving-a-repository-without-an-admin.md): Reject leaving a repository without an admin
- [FR-176](FR-176-let-a-repository-s-admins-remove-other-admins-or-s.md): Let a repository's admins remove other admins or step down

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. After its quality review in the design session of 2026-11-03 it was split: approvals went to SC-110 and the receiving project to SC-111. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: 3, Claude's share of the 8 the owner confirmed for the whole registry on 2026-11-02 ("Your estimates are perfect"); SC-019, SC-110 and SC-111 add up to it.
