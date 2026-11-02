---
certainty: assumed
actor: System admin
---

# UC-016: Give someone an account

## Goal

Let a new person use the tool. Nobody can create their own account: there is no self-registration ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Preconditions

- The actor is a system admin ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

## Steps

1. The system admin creates an account for the person ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md), [DD-027](DD-027-local-accounts-only-for-now.md)).

## Success criteria

- The person can sign in with the new account.

## Failure modes

- Anyone who is not a system admin cannot create accounts ([SRC-097](SRC-097-no-self-registration-a-system-admin-creates-accoun.md)).

Origin: composed by Claude from the items linked above, after the requirements graph was recorded. The order and wording of the steps are Claude's, not the stakeholder's; every step rests on a linked item. Confirmed by the stakeholder in the design session of 2026-11-02: "Every uc is ok".
