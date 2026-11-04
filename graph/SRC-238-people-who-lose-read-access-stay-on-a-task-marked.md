---
certainty: verified
source: design session
evidence: design session 2026-11-04
---

# SRC-238: People who lose read access stay on a task, marked, and cannot be added again

Whether a person can read a task's project is checked when they are assigned to the task or made eligible for it, and only then. Someone who later loses read access to the project stays where they were written, in the task's assignment or its eligibility expression, and is marked in the UI as not having read access. They can be removed from the task, but not assigned to it or made eligible for it again while they cannot read the project.

As received, in the design session of 2026-11-04, in the review of the eligibility and assignment module (SC-005, PR #76). Asked whether the read-access check should cover only the people a change adds, and what should happen to someone who loses access after being made eligible or assigned: "only when issue assigned. People not having read access to the project remains written there, but marked in ui. The can be removed from an issue but not assigned". Then, asked whether the check also applies when someone is made eligible: "yes eligibility too". Asked which component should carry the UI marking: "be creative".

Claude reads "issue" as the task, since a task is what is assigned in the tool; the owner's question was about tasks.
