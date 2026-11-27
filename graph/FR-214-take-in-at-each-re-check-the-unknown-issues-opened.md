---
certainty: assumed
---

# FR-214: Take in, at each re-check, the unknown issues opened since their repository was added

At each re-check ([FR-101](FR-101-re-check-all-linked-issues-at-the-configured-in.md)), whether or not a webhook is configured, the system must add each issue of a repository that a project pulls issues from, which no task is linked to and which was opened since the repository was added to the project that receives its new issues, to that project, as it adds an issue just opened on GitHub ([FR-100](FR-100-create-an-unscheduled-task-for-each-new-issue-open.md), [FR-157](FR-157-send-a-shared-repository-s-new-issues-to-its-recei.md), [SRC-297](SRC-297-the-re-check-also-takes-in-issues-it-does-not-know.md)). An issue still open becomes an unscheduled task ([FR-156](FR-156-never-create-a-planned-task-from-github.md)); an issue already closed becomes a done task, with the day it was closed as its actual finish ([SRC-297](SRC-297-the-re-check-also-takes-in-issues-it-does-not-know.md)). Issues opened before the repository was added are left to seeding ([SRC-297](SRC-297-the-re-check-also-takes-in-issues-it-does-not-know.md)).

It serves [UC-009](UC-009-triage-a-task-that-arrived-from-github.md).

Origin: composed by Claude from the items linked above, for issue #245. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item. It awaits the owner's confirmation.
