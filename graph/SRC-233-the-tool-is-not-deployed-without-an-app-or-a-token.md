---
certainty: verified
source: design session
evidence: design session 2026-11-03
---

# SRC-233: The tool is not deployed without an App or a token

The tool does not even deploy if neither a GitHub App nor a personal access token was given ([SRC-229](SRC-229-github-access-may-use-personal-access-tokens-beside.md)).

As received, in the design session of 2026-11-03, told that the tool would refuse to start when a GitHub function is given both an App and a token, or neither, and that a token would be given as its value: "ok but dont even deploy if no app or pat was given."

Read as: an installation whose configuration gives a function neither an App nor a token does not start, so it cannot be deployed. The reading is Claude's and awaits the owner's confirmation.
