---
source: document
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# SRC-038: Person load by task type and AI share

Person load depends on the task type:

- A normal (human) task is 100% load: the assigned person is fully busy for the task's duration.
- A partly AI task is 100% minus the AI share. A 50% AI task is 50% load, so one person can run two such tasks in parallel.
- An AI-only task: the person only starts it, it is still assigned to them, and they can run any number of them in parallel. Its load figure, first recorded as "about 0–1%", was overtaken in the design session of 2026-11-02 and is recorded in SRC-160.

As received: "normal tasks will be 100% person load, AI only tasks ... will be 1 or 0% person load".
