---
certainty: verified
source: design session
evidence: design session 2026-11-02
---

# SRC-159: What cancelling a task does

Cancelling a task ([DD-017](DD-017-an-issue-closed-as-not-planned-is-reopened-tasks-a.md)):

- frees its load;
- leaves each task it blocked blocked by whatever the cancelled task was blocked by;
- still shows it in views that have a column for cancelled tasks;
- closes its GitHub issue as "not planned".

As received, asked what cancelling does to the task's load, to the tasks it blocks, to its place in the views and to its GitHub issue: "load: gets freed. Tasks it blocks: will be blocked by whatever the cancelled task is blocked by. Shows in views yes, if they have a cancel column Github issue is closed as not planned".
