---
certainty: verified
source: document
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# SRC-002: The tool is the single source of truth for planning; GitHub only for execution status

The tool is the single source of truth for tasks, assignments and schedules. All planning (dates, constraints, assignments) lives in the tool. GitHub mirrors the plan and is used only for execution status: it may only start, hold and finish tasks.

As received: "I want this tool to be the single source of truth, and the GH only be able to start, hold and finish the task."

In the design session of 2026-11-02 the stakeholder added cancelling: closing a task's issue as "not planned" on GitHub cancels the task. That is recorded in SRC-171.
