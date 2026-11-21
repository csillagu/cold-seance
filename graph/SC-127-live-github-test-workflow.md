---
certainty: assumed
effort: 1
---

# SC-127: Live GitHub test workflow

The GitHub Actions workflow, started by hand only, that runs the live GitHub test suite (SC-126) against the test deployment, with the deployment's address, the first system admin's credentials, the test repository and the suite's personal access tokens taken from the secrets and variables of the `live` environment, which Terraform writes (SC-125) ([DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md), [SRC-264](SRC-264-the-github-side-is-tested-against-a-real-github-re.md)). It runs on no pull request and no push.

It is done when the workflow can be started from the Actions tab, runs the suite, and fails, naming the setting, when one of its secrets or variables is missing.

Origin: derived by Claude from [DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md) for issue #225. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
