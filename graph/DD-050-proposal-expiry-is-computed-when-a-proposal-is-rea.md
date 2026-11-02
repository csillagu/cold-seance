---

---

# DD-050: Proposal expiry is computed when a proposal is read

## Decision

A proposal stores the time it was last edited. Whenever it is read, it counts as expired if that edit is more than 24 hours old. No background job expires proposals.

## Alternatives considered

A job queue that expires proposals on a schedule (the retired DD-047), a timer in the backend that expires them periodically, or computing expiry when a proposal is read.

## Rationale

Expiry follows from one stored time, so it can be computed when needed, in the same way as variance ([DD-037](DD-037-variance-is-computed-not-stored.md)). Nothing runs in the background, so an idle tool does not contact the database, and no timer or queue is needed.

## Trade-offs

An expired proposal stays in the database until something removes it; it is only treated as expired.

## Risks

- A path that reads a proposal without applying the expiry rule would show or approve an expired proposal. The rule must live in the one service layer ([DD-039](DD-039-one-logic-layer-for-ui-rest-api-and-mcp-server.md)).

## Serves

This decision serves [FR-081](FR-081-expire-a-proposal-untouched-for-24-hours.md), [DD-024](DD-024-proposals-untouched-for-24-hours-expire.md).

Origin: proposed by Claude in the design session of 2026-11-02, in place of the job queue of the retired DD-047, after the stakeholder questioned why the queue checks the database every few seconds. The alternatives, rationale, trade-offs and risks are Claude's. The stakeholder confirmed the decision in the same session: "lets remove that and do the two proposed points". The Risks section awaits the stakeholder's confirmation.
