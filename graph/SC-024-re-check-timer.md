---
certainty: assumed
effort: 3
---

# SC-024: Re-check timer

The timer inside the backend process that re-checks every linked issue at the interval set in the configuration, one hour by default ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)), stores the time of its last run in the database, runs at once on start if that run is older than the interval, and takes a database lock so that only one backend instance runs it at a time ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md)). Each run also lists the issues of every repository that projects pull issues from and hands each one that no task is linked to, opened since the repository was added to the project that receives it, to the GitHub change handler to be taken in, whether or not a webhook is configured ([SRC-297](SRC-297-the-re-check-also-takes-in-issues-it-does-not-know.md)). A change it finds is recorded in the audit log under whoever GitHub names for it, and where GitHub names no one, as found by the re-check ([SRC-253](SRC-253-a-change-the-re-check-finds-is-logged-under-whoeve.md)).

It delivers:

- [FR-101](FR-101-re-check-all-linked-issues-at-the-configured-in.md): Re-check all linked issues at the configured interval
- [FR-214](FR-214-take-in-at-each-re-check-the-unknown-issues-opened.md): Take in, at each re-check, the unknown issues opened since their repository was added

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect". The interval became a setting in the design session of 2026-11-03 (DD-059); the effort was kept. Who a change it finds is recorded under was added by Claude for issue #131 from the owner's answer in the design session of 2026-11-15 (SRC-253); it awaits the owner's confirmation. Listing the pulled repositories' issues was added by Claude for issue #245 from the owner's answers in the design session of 2026-11-27 (SRC-297); it awaits the owner's confirmation, and whether the confirmed effort still holds with it awaits the owner.
