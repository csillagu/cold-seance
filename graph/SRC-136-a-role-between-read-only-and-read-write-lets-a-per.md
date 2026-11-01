---
certainty: verified
source: design session
evidence: design session 2026-11-01
---

# SRC-136: A role between read-only and read-write lets a person set the status of their assigned tasks

There is a project role above read-only ([SRC-091](SRC-091-read-only-role.md)) and below read-write ([SRC-092](SRC-092-read-write-role.md)). A person with it can mark a task they are assigned to ([SRC-032](SRC-032-assignment-is-a-concrete-list-of-people.md)) as in progress, on hold or finished.

As received: "User with a specific role (lower than write, higher than read) marks his assigned task in progress/on hold/ finished."

It cannot edit a task's other fields, cancel a task, or reopen a finished one.

That the role covers only tasks the person is assigned to was the drafting agent's reading of "his assigned task"; asked to confirm, the stakeholder said: "yes". Asked whether the role can also edit other fields of its own tasks, cancel them or reopen a finished one, the stakeholder said: "none of these". Not stated: the role's name.
