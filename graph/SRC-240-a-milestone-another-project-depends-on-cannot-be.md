---
certainty: verified
source: design session
evidence: design session 2026-11-04
---

# SRC-240: A milestone another project depends on cannot be cancelled

A milestone that blocks a task of another project cannot be cancelled. Cancelling it is refused, whatever the milestone is itself blocked by.

As received, in the design session of 2026-11-04, in the review of the task cancellation (SC-038, PR #86). The owner was told that cancelling a milestone of one project that blocks a task of another project would pass the milestone's blockers on to that task, though only a milestone of another project may block a task there and the canceller may not be able to read the blockers' project. Asked first about a blocker that is not a milestone, the owner chose "Refuse the cancel". Asked then about a blocker that is a milestone of a third project, the owner answered: "Refuse, no referenced milestone can be deleted". Asked to confirm that this means refusing to cancel any milestone that blocks a task of another project, whatever its own blockers, the owner chose "Milestone rule".
