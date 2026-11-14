---
certainty: assumed
effort: 2
---

# SC-117: Project repository removal

The function of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) with which a project's admin removes a repository from the repositories the project pulls issues from ([SRC-243](SRC-243-a-project-s-admin-removes-a-repository-from-the-pr.md)). The project then stops pulling issues from it. If the project was the repository's receiving project, no project receives the repository's new issues after it ([SRC-215](SRC-215-after-the-receiving-project-stops-pulling-no-p.md)).

The project keeps the tasks it already has from the repository, linked to their GitHub issues but no longer synced with them, as after a withdrawal ([SRC-250](SRC-250-tasks-kept-after-a-repository-is-removed-stay-link.md)).

It is done when a project's admin can remove a repository from the project, after which the project gets no new issues from it, and keeps its tasks from it, linked but not synced.

Not stated: whether the project's repository settings screen (SC-081) offers the removal.

It delivers:

- [FR-142](FR-142-let-a-project-set-which-repositories-it-pulls-issu.md): Let a project set which repositories it pulls issues from
- [FR-208](FR-208-keep-a-project-s-tasks-from-a-removed-repository-.md): Keep a project's tasks from a removed repository, linked but not synced

Origin: added by Claude at the owner's request in the design session of 2026-11-05 ([SRC-243](SRC-243-a-project-s-admin-removes-a-repository-from-the-pr.md)). The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
