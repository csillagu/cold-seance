# SC-048: Proposal approval

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that applies an approved proposal's changes all together or not at all, against the plan version the reviewer saw, asks for a new confirmation if the plan changed since, and for a proposal over several projects waits for each project's part to be approved in that project ([DD-025](DD-025-a-proposal-may-span-several-projects-each-project.md)).

It delivers:

- [FR-077](FR-077-apply-an-approved-proposal-s-changes-together.md): Apply an approved proposal's changes together
- [FR-078](FR-078-ask-the-reviewer-to-confirm-again-if-the-plan-chan.md): Ask the reviewer to confirm again if the plan changed since the preview
- [FR-080](FR-080-let-each-project-s-part-of-a-proposal-be-approved.md): Let each project's part of a proposal be approved in that project
- [FR-132](FR-132-apply-a-multi-project-proposal-only-when-every-par.md): Apply a multi-project proposal only when every part is approved

Origin: split off from SC-011, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
