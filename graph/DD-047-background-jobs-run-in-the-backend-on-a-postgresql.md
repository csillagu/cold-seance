# DD-047: Background jobs run in the backend on a PostgreSQL-backed queue

## Decision

Work that runs on a timer, such as the hourly reconciliation of linked issues ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)) and the expiry of proposals untouched for 24 hours ([DD-024](DD-024-proposals-untouched-for-24-hours-expire.md)), runs inside the backend process on a job queue stored in PostgreSQL, using the pg-boss library.

## Alternatives considered

A PostgreSQL-backed queue in the backend, BullMQ on Redis, the host's cron or a separate worker container, or in-memory timers.

## Rationale

PostgreSQL is already required ([SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md)), so the queue adds no service to install, which keeps installation simple ([SRC-199](SRC-199-people-can-install-the-tool-simply.md)). Jobs stored in the database survive a restart and run once even with several backend instances. In-memory timers are lost on restart. Redis or a separate worker adds a service to run and configure.

## Trade-offs

Adds load to PostgreSQL. Jobs cannot be scaled apart from the backend. Adds a dependency on pg-boss.

## Risks

- A long job, such as reconciling many issues within GitHub's rate limits, runs in the same process as the API and can slow its responses.
- A job that keeps failing, for example while GitHub is unreachable, stops the sync without anyone noticing unless its failures are shown.
- pg-boss is maintained by a small team. If it is abandoned, the queue has to be replaced.

## Serves

This decision serves [SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md), [DD-024](DD-024-proposals-untouched-for-24-hours-expire.md), [SRC-196](SRC-196-the-tool-s-data-is-stored-in-postgresql.md), [SRC-199](SRC-199-people-can-install-the-tool-simply.md).

Origin: proposed by Claude at the stakeholder's request in the design session of 2026-11-02 ("5-7 propose"). The alternatives, rationale and trade-offs are Claude's. Confirmed by the stakeholder in the design session of 2026-11-02: "1 confirmed". The Risks section was added by Claude afterwards, at the stakeholder's request ("Ok ok add risks"), and awaits the stakeholder's confirmation.
