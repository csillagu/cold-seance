---
certainty: verified
source: design session
evidence: design session 2026-11-19
---

# SRC-271: The test deployment pulls the private image with a classic read:packages token

The test deployment gets the tool's image, `ghcr.io/csillagu/cold-seance`, which stays private, with a classic personal access token of the owner's that has only the `read:packages` scope.

As received, in the design session of 2026-11-19:

- Told that the image `ghcr.io/csillagu/cold-seance` is private and that fine-grained tokens cannot read GitHub Packages, and asked how the test deployment should get the image, the owner chose "Classic token, read:packages": a classic token with only that scope, over making the package public.
