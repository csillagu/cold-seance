---
certainty: verified
source: design session
evidence: design session 2026-11-14
---

# SRC-250: Tasks kept after a repository is removed stay linked but are not synced

When a project's admin removes a repository from the repositories the project pulls issues from ([SRC-243](SRC-243-a-project-s-admin-removes-a-repository-from-the-pr.md)), the project keeps the tasks it already has from that repository, and they are treated as the tasks kept after a withdrawal are ([SRC-217](SRC-217-tasks-kept-after-a-withdrawal-stay-linked-but-are.md)): they stay linked to their GitHub issues, but the tool stops syncing them with those issues.

As received, in the design session of 2026-11-14. Asked, on issue #113, "What becomes of the tasks the project already has from a removed repository?", the owner answered: "It stays there. Locked basically". Asked which reading of "locked" was meant, with the options "Same as a withdrawal" (the tasks stay with all their fields and their GitHub issue link, but the tool stops syncing them with GitHub in both directions; they can still be edited in the tool), "Unsynced and read-only" and "Read-only, still synced", the owner chose: "Same as a withdrawal".
