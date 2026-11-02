# SC-011: Proposal preview and approval module

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that applies a proposal's inputs to an in-memory copy of the live plan, runs the scheduler on it ([DD-046](DD-046-scheduling-is-the-project-s-own-code-in-the-servic.md)) and returns the differences and new red flags ([DD-021](DD-021-proposal-live-preview-against-the-current-plan.md)); finds real conflicts only ([DD-022](DD-022-proposal-conflicts-are-real-conflicts-only.md)); and on approval applies the approved changes all together or not at all, each project's part approved in that project ([DD-025](DD-025-a-proposal-may-span-several-projects-each-project.md)).

It delivers:

- [FR-071](FR-071-leave-the-live-plan-unchanged-until-a-proposal-is.md): Leave the live plan unchanged until a proposal is approved
- [FR-072](FR-072-preview-a-proposal-against-the-current-plan.md): Preview a proposal against the current plan
- [FR-076](FR-076-show-a-proposal-s-conflicts-for-the-reviewer-to-re.md): Show a proposal's conflicts for the reviewer to resolve or drop
- [FR-077](FR-077-apply-an-approved-proposal-s-changes-together.md): Apply an approved proposal's changes together
- [FR-078](FR-078-ask-the-reviewer-to-confirm-again-if-the-plan-chan.md): Ask the reviewer to confirm again if the plan changed since the preview
- [FR-079](FR-079-never-rebase-a-proposal-beyond-its-live-preview.md): Never rebase a proposal beyond its live preview
- [FR-080](FR-080-let-each-project-s-part-of-a-proposal-be-approved.md): Let each project's part of a proposal be approved in that project
- [FR-132](FR-132-apply-a-multi-project-proposal-only-when-every-par.md): Apply a multi-project proposal only when every part is approved

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
