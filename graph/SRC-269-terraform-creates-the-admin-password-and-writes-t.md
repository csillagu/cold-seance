---
certainty: verified
source: design session
evidence: design session 2026-11-19
---

# SRC-269: Terraform creates the admin password and writes the live tests' settings into the `live` environment

The first system admin's password and the deployment's address come from Terraform, and are created automatically. Terraform also writes them, and the live tests' other settings, into the `live` GitHub environment of csillagu/cold-seance.

As received, in the design session of 2026-11-19:

- "live admin password and live url should come from the terraform, and should be created automatically, no?"
- Asked whether Terraform should also write the generated password, the address and the other `LIVE_` settings into the `live` GitHub environment of csillagu/cold-seance, the owner chose "Yes, Terraform writes them".
