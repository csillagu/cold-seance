# SC-009: Baseline module of the service layer

The module of the service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)) that saves named snapshots of a project's planned dates, several per project ([DD-036](DD-036-a-baseline-is-a-named-snapshot-of-planned-dates-mu.md)), and computes variance against a selected baseline when it is asked for, without storing it ([DD-037](DD-037-variance-is-computed-not-stored.md)).

It delivers:

- [FR-064](FR-064-save-a-named-baseline-of-a-project-s-planned-dates.md): Save a named baseline of a project's planned dates
- [FR-065](FR-065-require-the-read-write-role-to-save-a-baseline.md): Require the read-write role to save a baseline
- [FR-066](FR-066-compute-variance-against-a-selected-baseline.md): Compute variance against a selected baseline
- [FR-153](FR-153-keep-several-baselines-per-project.md): Keep several baselines per project

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The component's boundary and name are Claude's; it awaits the owner's confirmation. Effort: not stated; it awaits the owner's estimate.
