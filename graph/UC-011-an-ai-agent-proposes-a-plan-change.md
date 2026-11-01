---
certainty: assumed
actor: AI agent
---

# UC-011: An AI agent proposes a plan change

## Goal

Suggest changes to the plan, which people then review, without changing the live plan directly.

## Preconditions

- The agent has been given a role in the tool ([SRC-094](SRC-094-the-same-roles-apply-to-api-tokens-and-mcp-server.md)).

## Steps

1. The agent reads the plan ([SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md)).
2. It creates a proposal: a set of changes, such as new tasks, date moves, assignments and constraints, against the current plan ([SRC-079](SRC-079-a-proposal-is-a-set-of-changes-against-the-current.md), [SRC-006](SRC-006-ai-proposes-humans-approve.md)).
3. It groups the changes that only make sense together ([DD-023](DD-023-proposal-changes-are-grouped.md)).
4. The proposal waits for review, and the people who can review it are notified ([SRC-015](SRC-015-notifications-for-new-red-flags-proposals-waiting.md)). The agent can read notifications too ([SRC-017](SRC-017-the-api-and-mcp-server-can-read-notifications.md)).

## Success criteria

- The proposal is waiting for review, and the live plan is unchanged ([SRC-081](SRC-081-on-approval-all-changes-are-applied-together.md)).

## Failure modes

- The agent cannot change the plan directly; it can only create proposals ([SRC-078](SRC-078-mcp-server-reads-the-plan-and-writes-only-by-creat.md)).
- A proposal nobody touches for 24 hours expires ([DD-024](DD-024-proposals-untouched-for-24-hours-expire.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. To be confirmed by the stakeholder.
