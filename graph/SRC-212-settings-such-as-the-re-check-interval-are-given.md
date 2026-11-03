---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-212: Settings such as the re-check interval are given in configuration

Besides secrets ([SRC-210](SRC-210-secrets-are-given-in-configuration-not-typed-in.md)), other settings of the tool, such as the interval of the re-check of linked issues ([SRC-073](SRC-073-hourly-reconciliation-of-all-linked-issues.md)), are given in configuration. Which other settings are meant is not stated.

As received, in the design session of 2026-11-03: "Anither thing: this admin typing secrets by hand is not a good thing to do, i propose its done in a config yml environmental variable. Alomg with poll intervall etc etc. what do you say?"
