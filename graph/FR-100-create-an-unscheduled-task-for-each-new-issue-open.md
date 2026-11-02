---
certainty: assumed
---

# FR-100: Create an unscheduled task for each new issue opened on GitHub

When an issue is opened in a repository that a project pulls issues from, by a third party or for a non-plannable item such as a bug, the system must add it to that project automatically as an unscheduled task ([SRC-169](SRC-169-a-project-sets-which-repositories-it-pulls-issues.md), [SRC-061](SRC-061-new-third-party-github-issues-become-unscheduled-t.md), [SRC-115](SRC-115-new-non-plannable-github-issues-become-unscheduled.md)).

Not stated: what happens when several projects pull issues from the same repository.

It serves [UC-009](UC-009-triage-a-task-that-arrived-from-github.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
