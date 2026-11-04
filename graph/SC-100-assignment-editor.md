---
certainty: assumed
effort: 2
---

# SC-100: Assignment editor

The editor in which a task's assigned people are chosen, people outside its eligibility accepted ([DD-031](DD-031-assignment-may-include-people-outside-the-eligibil.md)), with a person-load override per assignment ([DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)) and 1% offered as the default for an AI-only task. Each assigned person who cannot read the task's project is marked, and a person cannot be chosen twice. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It delivers:

- [FR-029](FR-029-store-assignment-as-a-concrete-list-of-people.md): Store assignment as a concrete list of people
- [FR-030](FR-030-accept-an-assignment-that-includes-people-outside.md): Accept an assignment that includes people outside the eligibility expression
- [FR-033](FR-033-let-a-single-assignment-override-the-task-s-person.md): Let a single assignment override the task's person-load percentage
- [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md): Let an AI-only task's load be any percentage, 1% by default
- [FR-199](FR-199-mark-the-people-on-a-task-who-cannot-read-its-proj.md): Mark the people on a task who cannot read its project: in the assigned people
- [FR-200](FR-200-reject-an-assignment-that-names-a-person-twice.md): Reject an assignment that names a person twice

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it. FR-199 and FR-200 were added for issue #77; which SC marks the people of FR-199 is Claude's choice, the owner having answered "be creative".
