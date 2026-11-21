---
certainty: verified
source: design session
evidence: design session 2026-11-21
---

# SRC-273: The live tests against a started server run in CI on every pull request, with no fail-soft target

The live GitHub tests against a server the test run starts ([SRC-272](SRC-272-the-live-github-tests-also-run-against-a-server.md)) are a GitHub Actions job that runs automatically on every pull request with the other checks, and can be run locally too. They use the real GitHub App API, with the same test repository, GitHub App and tokens as the deployment tests. A run never picks its target by itself, by whether a setting is present. With no webhook, the tool sees changes made on GitHub at a short re-check, and the tests stay the same. In CI the database is a PostgreSQL service container. TC-147, a new issue opened on GitHub becoming a task, needs a webhook, so it is left out until the tool can take in new issues without one, which is its own issue (#245). Dependabot pull requests, which get no Actions secrets, fail the job. All live runs wait in one queue. The job has no approval gate.

As received, in the design session of 2026-11-21:

- Offered one suite whose target is the deployment when a deployment address is given and a server it starts itself otherwise: "I dont understand, this issue is about testing with the actual gh app api, without the live deployment, I dont understand why you are asking this. Anyways, these kind of fail soft solutions are NEVER acceptable."
- Asked whether to use the same test repository, App and token as the deployment tests: "Same as deployment (Recommended)".
- Asked whether, with no webhook, the server re-checks often and the tests stay the same: "Short re-check, same tests (Recommended)".
- Asked where PostgreSQL comes from in CI: "Service container (Recommended)".
- Told the run would be on the owner's machine and from a manual CI dispatch: "this is supposed be a gh action, no?", then "whynot on prs? run it automatically wit hthe rest. it can be run locally too okay".
- Told TC-147 cannot pass without a webhook: "good mention, about the tc147 not possible without webhook. create an issue about enabling gh issue reading without webhooks too." Asked what the suite does with TC-147 meanwhile: "Leave it out until #245 (Recommended)".
- Asked how Dependabot pull requests, which cannot read the Actions secrets, are handled: "Let them fail".
- Asked whether every live run, of every pull request and of the deployment workflow, waits in one queue: "One queue, all runs (Recommended)".
- Asked whether the `live` environment keeps an approval gate: "No approval gate (Recommended)".
