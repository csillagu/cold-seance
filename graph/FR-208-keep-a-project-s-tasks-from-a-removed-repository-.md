---
certainty: assumed
---

# FR-208: Keep a project's tasks from a removed repository, linked but not synced

When a project's admin removes a repository from the repositories the project pulls issues from ([SRC-243](SRC-243-a-project-s-admin-removes-a-repository-from-the-pr.md)), the system must keep in the project every task it already has from that repository, with every field recorded on it unchanged and its link to its GitHub issue, must not delete or move any of them, and must switch off syncing them with their GitHub issues in both directions: it neither writes their planning to the issues nor takes status changes from them ([SRC-250](SRC-250-tasks-kept-after-a-repository-is-removed-stay-link.md)).

Origin: composed by Claude from the items linked above, for issue #113, from SRC-250, which treats these tasks as SRC-217 treats the tasks kept after a withdrawal; the wording follows FR-178 and FR-182. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
