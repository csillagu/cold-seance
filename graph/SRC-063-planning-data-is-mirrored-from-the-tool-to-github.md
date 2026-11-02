---
source: document
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# SRC-063: Planning data is mirrored from the tool to GitHub and always kept identical

The tool mirrors planning data to GitHub and always keeps it identical:

- sub-issue relations ↔ subtasks
- blocked-by / blocking relations ↔ task dependencies
- assignees ↔ assigned people
- fixed dates of milestones

As received: "GH issues must always have the same constraints as the tool has". Mirroring assignees and fixed dates was the drafting agent's addition.
