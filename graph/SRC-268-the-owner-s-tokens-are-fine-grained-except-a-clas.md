---
certainty: verified
source: design session
evidence: design session 2026-11-19
---

# SRC-268: The owner's tokens are fine-grained, except a classic one for the Project kept under csillagu

The personal access tokens the owner makes for the test deployment and its tests are fine-grained, except for reading and setting the status field of the test repository's GitHub Project. The test repository and its Project stay under csillagu, and that one token is classic.

As received, in the design session of 2026-11-19:

- "I will use fine grained tokens"
- Told that fine-grained tokens cannot reach a GitHub Project owned by a user and that Project webhooks are sent for an organization's Projects only, and asked where the test repository and its Project should live, the owner chose "Under csillagu, classic for Projects": fine-grained tokens for everything except reading and setting the Project's status field, which needs a classic token.
