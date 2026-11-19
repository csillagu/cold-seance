---
certainty: verified
source: design session
evidence: design sessions 2026-11-17 and 2026-11-19
---

# SRC-265: The test deployment runs on GCP and Neon, with webhooks and fine-grained tokens, set up by Terraform the owner runs

The project has a deployment of its own, dedicated to testing the tool's GitHub side against a real GitHub repository. It runs on Google Cloud (GCP), as cheaply as possible or for free, with its database on Neon. Both are set up by Terraform scripts in the repository, which the owner runs from their own machine. The deployment reaches GitHub through a GitHub App for some functions and a personal access token for others, and it uses webhooks. The owner's tokens are fine-grained, except for reading and setting the status field of the test repository's GitHub Project, which stays under csillagu and needs a classic token. The first system admin's password and the deployment's address come from Terraform, which also writes them, and the live tests' other settings, into the `live` GitHub environment. Which function uses the App and which a token is not stated.

As received, in the design session of 2026-11-17, in answer to issue #225's questions:

- On where to deploy: "We will use gcp and some terraform scripts for the deployment. Just create it, I will do the deployment locally". On what should run it on GCP: "Whatever is cheaper/free".
- On its database: "Neon, also from terraform".
- On its use: "Dedicated test instance".
- On reaching GitHub: "Github app for few things, pat for something else, no webhook". On which function gets which: "Truly dont care, please decide."

As received, in the design session of 2026-11-19, which overtakes "no webhook":

- "lets have webhooks."
- "I will use fine grained tokens"
- "live admin password and live url should come from the terraform, and should be created automatically, no?"
- Told that fine-grained tokens cannot reach a GitHub Project owned by a user and that Project webhooks are sent for an organization's Projects only, and asked where the test repository and its Project should live, the owner chose "Under csillagu, classic for Projects": fine-grained tokens for everything except reading and setting the Project's status field, which needs a classic token.
- Asked whether Terraform should also write the generated password, the address and the other `LIVE_` settings into the `live` GitHub environment of csillagu/cold-seance, the owner chose "Yes, Terraform writes them".
