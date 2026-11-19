---
certainty: verified
source: design session
evidence: design session 2026-11-19
---

# SRC-268: The owner's tokens are fine-grained, except classic ones for the Project kept under csillagu and for the image

The personal access tokens the owner makes for the test deployment and its tests are fine-grained, except for reading and setting the status field of the test repository's GitHub Project, and for pulling the tool's private image from the GitHub Container Registry. The test repository and its Project stay under csillagu. Those two tokens are classic.

As received, in the design session of 2026-11-19:

- "I will use fine grained tokens"
- Told that fine-grained tokens cannot reach a GitHub Project owned by a user and that Project webhooks are sent for an organization's Projects only, and asked where the test repository and its Project should live, the owner chose "Under csillagu, classic for Projects": fine-grained tokens for everything except reading and setting the Project's status field, which needs a classic token.
- Told that the image `ghcr.io/csillagu/cold-seance` is private and that fine-grained tokens cannot read GitHub Packages, and asked how the test deployment should get the image, the owner chose "Classic token, read:packages": a classic token with only that scope, over making the package public.
