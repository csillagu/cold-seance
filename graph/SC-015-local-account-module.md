# SC-015: Local account module

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that holds the accounts kept in the tool itself ([DD-027](DD-027-local-accounts-only-for-now.md)): creation by system admins, sign-in, system admin rights, the first system admin from an environment variable, and the link from an account to a GitHub account. How a signed-in browser session is kept is not stated.

It delivers:

- [FR-117](FR-117-let-only-system-admins-create-accounts.md): Let only system admins create accounts
- [FR-118](FR-118-sign-people-in-with-local-accounts.md): Sign people in with local accounts
- [FR-135](FR-135-let-a-person-or-a-system-admin-link-the-person-s-g.md): Let a person or a system admin link the person's GitHub account
- [FR-140](FR-140-let-system-admins-make-other-people-system-admins.md): Let system admins make other people system admins
- [FR-165](FR-165-set-up-the-first-system-admin-from-an-environment.md): Set up the first system admin from an environment variable

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
