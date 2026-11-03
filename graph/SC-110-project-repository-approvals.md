---
certainty: assumed
effort: 3
---

# SC-110: Project repository approvals

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that keeps which projects pull issues from which repositories, with each project's request, its approval or rejection by a repository admin, and the withdrawal of an approval. On withdrawal the project stops pulling and keeps its tasks from the repository. It is done when a request becomes a pull only once a repository admin approves it, or at once when the requester is admin of both, and when a withdrawn project gets no new issues from the repository and loses none of its tasks.

It delivers:

- [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md): Let a project set which repositories it pulls issues from
- [FR-168](FR-168-add-a-repository-to-a-project-only-once-one-of-its.md): Add a repository to a project only once one of its admins approves
- [FR-170](FR-170-add-a-repository-at-once-when-its-adder-is-admin-o.md): Add a repository at once when its adder is admin of both it and the project
- [FR-171](FR-171-let-a-repository-admin-reject-a-project-s-request-.md): Let a repository admin reject a project's request for the repository
- [FR-172](FR-172-let-a-repository-admin-withdraw-an-approval-given-.md): Let a repository admin withdraw an approval given to a project
- [FR-178](FR-178-keep-a-project-s-tasks-from-a-repository-after-i.md): Keep a project's tasks from a repository after its approval is withdrawn
- [FR-181](FR-181-stop-a-project-pulling-from-a-repository-whose-ap.md): Stop a project pulling from a repository whose approval is withdrawn

Origin: split off from SC-019 by Claude for issue #11, after its quality review found it bundled; the owner asked Claude to make such splits on its own in the design session of 2026-11-03. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's share of SC-019's confirmed effort of 8; the parts add up to it.
