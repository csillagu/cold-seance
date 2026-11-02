---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-169: A project sets which repositories it pulls issues from

On a project, one can set which repositories it pulls issues from. A new GitHub issue in those repositories is added to the project automatically ([SRC-192](SRC-192-every-new-github-issue-becomes-a-task-whoever-open.md)).

As received, asked how the tool knows which project a new GitHub issue belongs to: "New github issue will be added to a project automatically, on the project, one can set which repos to pull issues from."

This replaces DD-033, which assumed every issue belongs to exactly one project, with no mapping rules. Whether two projects can pull issues from the same repository was answered later; see SRC-174.
