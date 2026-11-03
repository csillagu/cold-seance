---
certainty: verified

---

# DD-051: The re-check runs on a timer in the backend

## Decision

The re-check of linked issues runs on a plain timer inside the backend process, at the interval set in the configuration ([SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md)), one hour by default ([SRC-213](SRC-213-the-re-check-interval-is-one-hour-by-default.md)). It stores the time of its last run in the database. On start, the backend runs the re-check at once if the last run is older than the interval, so a restart never skips one. A database lock stops two backend instances from running it at the same time, should there ever be two.

## Alternatives considered

A job queue stored in PostgreSQL (pg-boss, the retired DD-047), BullMQ on Redis, the host's cron or a separate worker container, an in-memory timer without a stored last run, or a timer with a stored last run.

## Rationale

Only one obligation in the requirements runs on a timer: the re-check of linked issues ([FR-101](FR-101-re-check-all-linked-issues-at-the-configured-in.md)). A queue checks the database every few seconds for new work, which an hourly task does not need, and it is one more dependency. With a timer, an idle tool contacts the database once per interval. Storing the last run makes the timer survive restarts. Redis, cron or a separate worker would add a service to install, against simple installation ([SRC-199](SRC-199-people-can-install-the-tool-simply.md)).

## Trade-offs

No automatic retries: a GitHub write that fails, for example while GitHub is down, is repaired by the next re-check, within the hour the stakeholder accepted as long as the interval is the default ([SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md)). Adding other timed work later means adding timers, not queueing jobs.

## Risks

- The re-check runs in the same process as the API; reconciling many issues within GitHub's rate limits can slow API responses.
- A re-check that keeps failing, for example while GitHub is unreachable, stops the sync without anyone noticing unless its failures are shown.

## Serves

This decision serves [SRC-212](SRC-212-settings-such-as-the-re-check-interval-are-given.md), [SRC-213](SRC-213-the-re-check-interval-is-one-hour-by-default.md), [FR-101](FR-101-re-check-all-linked-issues-at-the-configured-in.md), [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md), [SRC-191](SRC-191-an-hour-is-an-acceptable-delay-for-github-sync-and.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md).

Origin: proposed by Claude in the design session of 2026-11-02, in place of the job queue of the retired DD-047, after the stakeholder questioned why the queue checks the database every few seconds. The alternatives, rationale, trade-offs and risks are Claude's. The stakeholder confirmed the decision in the same session: "lets remove that and do the two proposed points". The stakeholder confirmed the Risks section in the same session: "1yes". In the design session of 2026-11-03 the interval became a setting, one hour by default (SRC-212, SRC-213, DD-059), and the title lost "hourly".
