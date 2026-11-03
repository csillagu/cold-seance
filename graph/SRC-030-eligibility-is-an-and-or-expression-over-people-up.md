---
certainty: verified
source: document
evidence: docs/initial-requirements.md; docs/src-dd-classification.md
---

# SRC-030: Eligibility is an AND/OR expression over people, up to 2 levels deep

Eligibility (who can do a task) is a logical expression over people, using AND and OR, up to 2 levels deep. Examples: `A`, `A OR B`, `A AND B`, `A AND (B OR C OR D)`, `(A AND B) OR C`.

As received: "A AND (B OR C OR D) etc. 2 deep is enough I would say".
