---
certainty: verified
source: design session
evidence: design session 2026-11-17
---

# SRC-266: The test deployment runs on GCP and Neon, set up by Terraform scripts the owner runs

The project has a deployment of its own, dedicated to testing the tool's GitHub side against a real GitHub repository. It runs on Google Cloud (GCP), as cheaply as possible or for free, with its database on Neon. Both are set up by Terraform scripts in the repository, which the owner runs from their own machine.

As received, in the design session of 2026-11-17, in answer to issue #225's questions:

- On where to deploy: "We will use gcp and some terraform scripts for the deployment. Just create it, I will do the deployment locally". On what should run it on GCP: "Whatever is cheaper/free".
- On its database: "Neon, also from terraform".
- On its use: "Dedicated test instance".
