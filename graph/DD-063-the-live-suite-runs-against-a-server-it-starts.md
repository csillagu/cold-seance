# DD-063: The live suite also runs against a backend it starts in its own process, as a CI job on every pull request

## Decision

The live GitHub test suite ([DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md)) has a second target, run by a command of its own ([SRC-272](SRC-272-the-live-github-tests-also-run-against-a-server.md), [SRC-273](SRC-273-the-live-tests-against-a-started-server-run-in-ci-o.md)):

- **Two commands, no fallback:** one command always runs the suite against the test deployment, the other always against a backend the run starts. Which target a run has is fixed by the command, never by which settings are present. Each stops before any test runs, naming every setting it needs that is missing.
- **The server:** the run's global setup starts the tool's backend in its own process, listening on a free port of the machine's loopback address, on a fresh database it creates on the PostgreSQL server the integration tests use, and drops that database when the run ends. The server is given only the settings the run sets, with no configuration file. Its first system admin gets a password generated for the run, which the tests sign in with.
- **GitHub access:** the same test repository, GitHub App and tokens as the deployment tests. The App reads and writes issues; the classic Projects token reads the status field. The App's id and the contents of its private key are two more settings of the `live` environment, which Terraform writes, as it does the others ([SC-125](SC-125-gcp-test-deployment-terraform-scripts.md)). The run writes the key to a file only it can read, since the tool reads the key from a file.
- **No webhook:** nothing reaches the server from GitHub, so it re-checks linked issues every minute, and a test waits three re-checks for a change made on GitHub. The tests are the same as against the deployment, except TC-147: only a webhook brings in a new issue opened on GitHub, so it is left out until the tool can take in new issues without one (#245).
- **CI:** a job of the CI workflow runs the command on every pull request and manual dispatch, in the `live` environment, with no approval gate, and with PostgreSQL as a service container. Every run of the suite, of either target, works in the one test repository, so that job and the deployment's workflow share one concurrency group and never run at once. Dependabot pull requests and pull requests from forks get no Actions secrets, so the job fails on them, naming the missing settings.

## Alternatives considered

- For the target: one suite that runs against the deployment when its address is given and against a started server otherwise (the owner refused any such fail-soft choice); a second copy of the tests for the started server.
- For the server: a child process running the built backend, as a test deployment does; the published Docker image. Starting it in the run's own process needs no build and shares the integration tests' database helper.
- For the database: a PostgreSQL the run starts itself (the owner chose a service container in CI).
- For the key: a setting naming a key file, as the tool's own setting does; a GitHub secret holds contents, not a file.
- For the waits: the deployment's interval of 2 minutes; skipping the tests that wait for a change made on GitHub (the owner chose a short re-check and the same tests).
- For concurrency: a test repository for each run (the owner chose one queue).
- For when it runs: on demand only, as the issue first said (the owner chose every pull request).

## Rationale

The owner wants the real GitHub App API checked without a deployment, automatically with the other checks ([SRC-273](SRC-273-the-live-tests-against-a-started-server-run-in-ci-o.md)), and refuses a target chosen by whether a setting is set: a run that silently tests something else than asked hides what it did not test. Keeping one set of test files and choosing the target by command gives both runs the same tests with no second copy. A fresh database for each run means nothing is left behind in the tool, unlike on the deployment. A re-check every minute stands in for the webhook the server cannot receive. One concurrency group keeps two runs from deleting each other's issues: the seeding test of one would import, then delete at its clean-up, the issues another just opened.

## Trade-offs

- Each pull request's checks take several minutes longer, and wait while another live run holds the test repository.
- Dependabot pull requests and pull requests from forks show the live job as failed.
- TC-147 runs only against the deployment until #245 is done.
- A run of the job records a deployment to the `live` environment on its pull request.

## Risks

- GitHub keeps at most one job waiting in a concurrency group: a third run that arrives cancels the one waiting, which then has to be run again.
- A run cancelled while it runs, as the CI workflow cancels an older run of a pull request when a new commit is pushed, may stop before its clean-up and leave issues and milestones in the test repository.
- The App's private key and the tokens reach every pull request's run from this repository's branches, with no approval.
- Many runs a day spend the App's and the tokens' GitHub API rate limits.

## Serves

This decision serves [SRC-272](SRC-272-the-live-github-tests-also-run-against-a-server.md), [SRC-273](SRC-273-the-live-tests-against-a-started-server-run-in-ci-o.md), [DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md).

Origin: issue #239 records the request (SRC-272); the owner answered its questions in the design session of 2026-11-21 (SRC-273). The two commands, the server in the run's own process, the fresh database, the key given as contents, the interval of one minute and the wait of three, the shared concurrency group with the deployment's workflow and the App's settings written by Terraform are Claude's, as are the wording, alternatives, rationale, trade-offs and risks; they await the owner's confirmation.
