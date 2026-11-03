---
certainty: assumed
effort: 5
---

# SC-022: GitHub planning mirror

The backend module that keeps the planning of linked issues identical to the tool, the plan being held in the tool, not in the issues ([DD-001](DD-001-the-plan-is-stored-in-the-tool-s-own-backend-not-i.md)): sub-issues, blocked-by relations, assignees (leaving off people without a linked GitHub account) and milestone dates. It leaves alone the issues of tasks a project kept after its approval for the repository was withdrawn. A write that fails is put right by the hourly re-check ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md)).

It delivers:

- [FR-089](FR-089-keep-planning-data-on-github-identical-to-the-tool.md): Keep planning data on GitHub identical to the tool
- [FR-090](FR-090-create-issues-without-a-github-assignee-for-people.md): Create issues without a GitHub assignee for people without a GitHub account
- [FR-182](FR-182-stop-syncing-kept-tasks-with-their-issues-after-a.md): Stop syncing kept tasks with their issues after a withdrawal

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it. Certainty stays assumed because the boundary and name are unconfirmed; only the effort is confirmed.
