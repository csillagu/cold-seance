---
effort: 13
---

# SC-023: GitHub change handler

The backend module that handles each change to a linked issue that reaches the tool from GitHub, by the GitHub App's webhooks ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md), [SRC-099](SRC-099-the-github-app-is-installed-per-repo-by-the-repo-s.md)) or found by the hourly re-check: start and hold from the Projects status field, finish by closing the issue ([DD-015](DD-015-start-and-hold-come-from-the-github-projects-statu.md)), cancel by closing it as not planned; it reverts status changes that break a constraint ([DD-032](DD-032-github-status-changes-that-break-a-constraint-are.md)) and planning edits made on GitHub, and turns each new issue into an unscheduled task in the receiving project. Every rule it applies is the service layer's ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)).

It delivers:

- [FR-091](FR-091-start-a-task-when-it-is-started-on-github.md): Start a task when it is started on GitHub
- [FR-092](FR-092-put-a-task-on-hold-when-it-is-put-on-hold-on-githu.md): Put a task on hold when it is put on hold on GitHub
- [FR-093](FR-093-finish-a-task-when-its-issue-is-closed-on-github.md): Finish a task when its issue is closed on GitHub
- [FR-094](FR-094-set-a-task-back-to-in-progress-when-its-finished-i.md): Set a task back to in progress when its finished issue is reopened
- [FR-095](FR-095-revert-github-status-changes-that-break-a-constrai.md): Revert GitHub status changes that break a constraint
- [FR-096](FR-096-cancel-a-task-when-its-issue-is-closed-as-not-plan.md): Cancel a task when its issue is closed as not planned
- [FR-097](FR-097-undo-planning-edits-made-on-github.md): Undo planning edits made on GitHub
- [FR-099](FR-099-accept-status-changes-from-github-whatever-the-per.md): Accept status changes from GitHub whatever the person's role in the tool
- [FR-100](FR-100-create-an-unscheduled-task-for-each-new-issue-open.md): Create an unscheduled task for each new issue opened on GitHub
- [FR-136](FR-136-treat-a-linked-issue-deleted-on-github-as-closed.md): Treat a linked issue deleted on GitHub as closed
- [FR-156](FR-156-never-create-a-planned-task-from-github.md): Never create a planned task from GitHub
- [FR-157](FR-157-send-a-shared-repository-s-new-issues-to-its-recei.md): Send a shared repository's new issues to its receiving project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
