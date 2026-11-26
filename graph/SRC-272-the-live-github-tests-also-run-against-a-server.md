---
source: ticket
evidence: GitHub issue 239 of csillagu/cold-seance
---

# SRC-272: The live GitHub tests also run against a server the test run starts, with no deployment

The live GitHub test suite ([SRC-264](SRC-264-the-github-side-is-tested-against-a-real-github-re.md)) also runs against real GitHub with a backend and PostgreSQL that the test run starts itself, against the dedicated test repository, so that the differences between real GitHub and the mocks can be checked without a deployed instance. With no webhook, the tool only calls GitHub, so nothing has to reach that server from outside. The deployment and the tests against it stay.

As received, in issue #239: "Run the live GitHub tests against **real GitHub**, with a server the test run starts itself, so that no deployment is needed." Under Why: "The unit and integration tests mock GitHub, so they only show that the tool works with the responses we expect. A run against the real GitHub API catches the differences: field names, permissions of the App and the token, how the Projects status field behaves, user-owned against org-owned Projects. This should be checkable without a deployed instance. The deployment and the tests against it stay in #225 / #238." Under Scope: "The live suite (`backend/test/live/`, from #238) runs against a backend and PostgreSQL that the run starts locally, against the dedicated test repository." and "Without webhooks the tool only calls GitHub, so nothing has to reach the local server from outside."

The issue also said the suite "runs locally and from a manual CI dispatch. It does not run on PRs, since it needs live credentials." The owner overtook that in the design session of 2026-11-21, which SRC-296 records.
