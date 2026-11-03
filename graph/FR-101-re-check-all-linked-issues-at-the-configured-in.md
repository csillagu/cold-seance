---
certainty: verified
---

# FR-101: Re-check all linked issues at the configured interval

The system must re-check all linked issues at the interval set in its configuration ([SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md)), one hour unless set otherwise ([SRC-213](SRC-213-the-re-check-interval-is-one-hour-by-default.md)), covering changes it missed while GitHub was down or its notifications did not arrive ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)), and handle each difference it finds exactly as if the change had just arrived ([SRC-152](SRC-152-the-hourly-re-check-handles-a-difference-as-a-chan.md)).

It serves [UC-008](UC-008-work-on-an-issue-from-github.md).

Origin: composed by Claude from the items linked above, for issue #5. The interval, every hour before, was made a setting with a default of one hour for issue #11, from SRC-212 and SRC-213. The wording is Claude's, not the stakeholder's; every obligation rests on a linked item.
