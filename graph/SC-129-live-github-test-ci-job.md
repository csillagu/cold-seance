---
certainty: assumed
effort: 1
---

# SC-129: Live GitHub test CI job

The job of the CI workflow that runs the live GitHub tests against a started server (SC-128) on every pull request and manual dispatch, with the other checks ([DD-063](DD-063-the-live-suite-runs-against-a-server-it-starts.md), [SRC-296](SRC-296-the-live-tests-run-in-ci-on-every-pull-request-each.md)). It runs in the `live` environment, waiting for the owner's approval of each run as that environment's required reviewer, takes its settings from that environment's secrets and variables, and has PostgreSQL as a service container. It shares one concurrency group with the deployment's live test workflow (SC-127), so that no two live runs work in the test repository at once. The deployment's Terraform scripts (SC-125) also write the GitHub App's id and private key into the `live` environment.

It is done when the job runs on a pull request, runs the suite, and fails, naming the setting, when one of its secrets or variables is missing; and when, after the Terraform scripts are applied again, the `live` environment holds the App's id and private key.

Origin: derived by Claude from [DD-063](DD-063-the-live-suite-runs-against-a-server-it-starts.md) for issue #239. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
