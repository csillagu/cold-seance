---
effort: 3
---

# SC-024: Hourly re-check timer

The timer inside the backend process that re-checks every linked issue once an hour, stores the time of its last run in the database, runs at once on start if that run is more than an hour old, and takes a database lock so that only one backend instance runs it at a time ([DD-051](DD-051-the-hourly-re-check-runs-on-a-timer-in-the-backend.md)).

It delivers:

- [FR-101](FR-101-re-check-all-linked-issues-every-hour.md): Re-check all linked issues every hour

Origin: derived by Claude from the linked FRs and DDs, at the owner's request ("Derive the solution components from the existing frs and dds", 2026-11-02), for issue #11. The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate, confirmed by the owner in the design session of 2026-11-02: "Your estimates are perfect".
