---
certainty: assumed
effort: 2
---

# SC-009: Baseline snapshots

The module of the service layer that saves, under a name, a snapshot of every task's planned start and finish in a project, keeps several per project ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)), and accepts a save only from someone with the read-write role there.

It delivers:

- [FR-064](FR-064-save-a-named-baseline-of-a-project-s-planned-dates.md): Save a named baseline of a project's planned dates
- [FR-065](FR-065-require-the-read-write-role-to-save-a-baseline.md): Require the read-write role to save a baseline
- [FR-153](FR-153-keep-several-baselines-per-project.md): Keep several baselines per project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The quality review found it bundled, and in the design session of 2026-11-02 the owner asked for it to be split: "1 yes please split. I want reqlite reviewer to be happy." It now holds the first part; the other parts are SCs of their own. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "4 correct".
