---
certainty: assumed
effort: 3
---

# SC-024: Re-check timer

The timer inside the backend process that re-checks every linked issue at the interval set in the configuration, one hour by default ([DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)), stores the time of its last run in the database, runs at once on start if that run is older than the interval, and takes a database lock so that only one backend instance runs it at a time ([DD-051](DD-051-the-re-check-runs-on-a-timer-in-the-backend.md)).

It delivers:

- [FR-101](FR-101-re-check-all-linked-issues-at-the-configured-in.md): Re-check all linked issues at the configured interval

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect". The interval became a setting in the design session of 2026-11-03 (DD-059); the effort was kept.
