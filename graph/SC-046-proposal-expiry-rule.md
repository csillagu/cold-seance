---
certainty: assumed
effort: 1
---

# SC-046: Proposal expiry rule

The rule in the service layer that treats a proposal as expired, whenever it is read, if its last edit is more than 24 hours old ([DD-024](DD-024-proposals-untouched-for-24-hours-expire.md), [DD-050](DD-050-proposal-expiry-is-computed-when-a-proposal-is-rea.md)).

It delivers:

- [FR-081](FR-081-expire-a-proposal-untouched-for-24-hours.md): Expire a proposal untouched for 24 hours

Origin: split off from SC-010, which the quality review found bundled, at the owner's request in the design session of 2026-11-02: "1 yes please split. I want reqlite reviewer to be happy." The boundary and name are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate for this component as it now stands. The owner confirmed Claude's list of proposed estimates in the design session of 2026-11-02, answering "correct" to it.
