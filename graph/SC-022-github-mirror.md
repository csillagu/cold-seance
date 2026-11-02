# SC-022: GitHub mirror

The backend module that writes the tool's planning to the GitHub issues of linked tasks, the plan being held in the tool, not in the issues ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)): it creates a task's issue once it is assigned to a repository, keeps sub-issues, blocked-by relations, assignees and milestone dates identical to the tool, closes a cancelled task's issue as not planned, and comments on the issue for every revert. A write that fails is put right by the hourly re-check ([DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md)).

It delivers:

- [FR-088](FR-088-create-a-task-s-github-issue-once-it-is-assigned-t.md): Create a task's GitHub issue once it is assigned to a repository
- [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md): Keep planning data on GitHub identical to the tool
- [FR-090](FR-090-create-issues-without-a-github-assignee-for-people.md): Create issues without a GitHub assignee for people without a GitHub account
- [FR-098](FR-098-comment-on-the-issue-for-every-revert.md): Comment on the issue for every revert
- [FR-130](FR-130-close-a-cancelled-task-s-github-issue-as-not-plann.md): Close a cancelled task's GitHub issue as not planned

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
