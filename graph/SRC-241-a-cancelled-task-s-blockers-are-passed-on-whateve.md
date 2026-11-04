---
certainty: verified
source: design session
evidence: design session 2026-11-04
---

# SRC-241: A cancelled task's blockers are passed on whatever the canceller can read

When a task that is not a milestone is cancelled and another project's milestone blocked it, that milestone is passed on to the tasks the cancelled task blocked, even if the person cancelling cannot read the milestone's project.

As received, in the design session of 2026-11-04, in the review of the task cancellation (SC-038, PR #86). The owner was asked whether to refuse cancelling a task B whose blocker is a milestone N of a project the canceller may not read, when C is blocked by B. The offered answer read "Milestone rule; pass N on: [...] In the B case, pass N on: no milestone is removed, N stays referenced, and the canceller makes no new reference to R". The owner chose it.
