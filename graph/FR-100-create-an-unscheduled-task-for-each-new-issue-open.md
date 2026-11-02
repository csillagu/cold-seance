---
certainty: assumed
---

# FR-100: Create an unscheduled task for each new issue opened on GitHub

When a third party opens an issue on GitHub, or someone opens one for a non-plannable item such as a bug, the system must create an unscheduled task for it in its project ([SRC-061](SRC-061-new-third-party-github-issues-become-unscheduled-t.md), [SRC-115](SRC-115-new-non-plannable-github-issues-become-unscheduled.md), [DD-033](DD-033-every-issue-belongs-to-exactly-one-project.md)).

Not stated: how the system knows which project the issue belongs to. [DD-033](DD-033-every-issue-belongs-to-exactly-one-project.md) assumes every issue belongs to exactly one project, and its open question, whether "project" meant the GitHub Project, still stands. Asked this, the stakeholder answered "none until assigned"; what "assigned" refers to is still to be clarified.

It serves [UC-009](UC-009-triage-a-task-that-arrived-from-github.md).

Origin: composed by Claude from the items linked above, for issue #5. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. Awaits the stakeholder's confirmation.
