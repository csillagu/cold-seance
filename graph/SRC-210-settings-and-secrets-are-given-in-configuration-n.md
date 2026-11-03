---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-210: Settings and secrets are given in configuration, not typed in by an admin

Secrets such as the GitHub Apps' private keys are not typed into the tool by an admin. They, and other settings such as the interval of the re-check of linked issues, are given in configuration: a YAML file or environment variables. Which other settings are meant is not stated. The owner put this as a proposal and asked for Claude's view.

As received, in the design session of 2026-11-03: "Anither thing: this admin typing secrets by hand is not a good thing to do, i propose its done in a config yml environmental variable. Alomg with poll intervall etc etc. what do you say?"
