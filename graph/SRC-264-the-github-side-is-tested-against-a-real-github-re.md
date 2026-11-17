---
source: ticket
evidence: GitHub issue 225 of csillagu/cold-seance
---

# SRC-264: The GitHub side is tested against a real GitHub repository, on demand

Besides the tests that run against a fake of GitHub, a last round of tests exercises the tool's GitHub side against a real GitHub repository. They cover issue creation, the sync of status, dates and the Projects status field, links, and the revert commenter. They set up and clean up their own data, and run on demand, by a manually started CI run, not on every pull request, since they need secrets and a live repository. The tool is also deployed somewhere reachable, and how is documented in the README.

As received, in issue #225: "We need a real deployment of the app, and a last round of integration tests that exercise the GitHub side against a **real GitHub repository** rather than mocks." Under Scope: "**Deployment:** run the Docker image (`Dockerfile`, `compose.yaml`) somewhere reachable, with its PostgreSQL, config and GitHub App or credentials, and document how in the README." and "**Real-repo tests:** a test suite against a dedicated test repository, covering the GitHub paths: issue creation, sync of status, dates and the Projects status field, links, the revert commenter, and webhooks if used. It should set up and clean up its own data, and run on demand (manual CI dispatch), not on every PR, since it needs secrets and a live repo."
