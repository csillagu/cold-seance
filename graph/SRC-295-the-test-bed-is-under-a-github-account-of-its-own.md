---
certainty: verified
source: design session
evidence: design session 2026-11-19; GitHub issue 261; design session 2026-11-25
---

# SRC-295: The test bed is under a GitHub account of its own, csillagu-alt, with a classic token for its Project

The live tests' test bed is under a GitHub account made only for testing, csillagu-alt, apart from the owner's own account, csillagu: the test repository, its GitHub Project, the GitHub App, and the Projects token, which csillagu-alt makes. The repository whose `live` environment the live tests run in, csillagu/cold-seance, stays under csillagu. The personal access tokens the owner makes for the test deployment and its tests are fine-grained, except for reading and setting the status field of the test repository's Project, which is a classic token. The token for pulling the tool's image is a separate choice ([SRC-271](SRC-271-the-test-deployment-pulls-the-private-image-with-a.md)).

As received, in the design session of 2026-11-19:

- "I will use fine grained tokens"
- Told that fine-grained tokens cannot reach a GitHub Project owned by a user and that Project webhooks are sent for an organization's Projects only, and asked where the test repository and its Project should live, the owner chose "Under csillagu, classic for Projects": fine-grained tokens for everything except reading and setting the Project's status field, which needs a classic token. Where the test bed lives was overtaken on 2026-11-25, below; the classic token for the Project still stands.

As received, in issue #261, which the owner opened:

- "Move the live GitHub tests' test bed off the owner's personal account onto a separate GitHub account made only for testing"
- "`github_projects_token` is a classic PAT with the `repo` scope, which gives full control of every repository the owner's account can reach, private ones included."
- "On an account that owns only the test bed, a leaked token reaches only the test repository and its Project."
- "Note: `environment_repository` stays `csillagu/cold-seance`; only the test bed moves."

As received, in the design session of 2026-11-25:

- Told that in a free organization fine-grained tokens and the App would reach the Project, the owner asked "so org would be for THIS repo (cold seance), the other repo might be another org? idk, how many free orgs can 1 person create", then chose an account: "moved the live repo to csillagu-alt. What other changes do I need to make (its not an org, its another account)".
- "app si ready (old one transfered)": the GitHub App was transferred to csillagu-alt.
- "project: 1": the test bed's Project is csillagu-alt's Project number 1.
