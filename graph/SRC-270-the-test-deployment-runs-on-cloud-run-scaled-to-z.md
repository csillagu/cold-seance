---
certainty: verified
source: design session
evidence: design session 2026-11-19
---

# SRC-270: The test deployment runs on Cloud Run, scaled to zero

The test deployment's backend runs on Google Cloud Run, scaled to zero, as the owner's csaladfa project does at about 0.9 USD a month, instead of on a virtual machine with a static IP address.

As received, in the design session of 2026-11-19:

- Asked why the deployment needs a static IP address and whether there is something cheaper: "why do we need static ip, is there something free-er?", then "check my csaladfa repo, that is like 0.9 usd/month".
- Given a comparison of Cloud Run scaled to zero with the virtual machine as it was, and asked to propose one: "compare the first and last, what do you propose?". On Claude's proposal of Cloud Run: "ok cloud run it is".
