# SC-100: Assignment editor

The editor in which a task's assigned people are chosen, people outside its eligibility accepted ([DD-031](DD-031-assignment-may-include-people-outside-the-eligibil.md)), with a person-load override per assignment ([DD-010](DD-010-the-person-load-percentage-can-be-overridden-per-a.md)) and 1% offered as the default for an AI-only task. It is part of the React frontend ([DD-045](DD-045-the-frontend-uses-react-built-with-vite.md)).

It delivers:

- [FR-029](FR-029-store-assignment-as-a-concrete-list-of-people.md): Store assignment as a concrete list of people
- [FR-030](FR-030-accept-an-assignment-that-includes-people-outside.md): Accept an assignment that includes people outside the eligibility expression
- [FR-033](FR-033-let-a-single-assignment-override-the-task-s-person.md): Let a single assignment override the task's person-load percentage
- [FR-149](FR-149-let-an-ai-only-task-s-load-be-any-percentage-1-by.md): Let an AI-only task's load be any percentage, 1% by default

Origin: added by Claude for issue #11. Asked whether the screens behind these FRs should be components too, the owner answered in the design session of 2026-11-02: "Yes please." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
