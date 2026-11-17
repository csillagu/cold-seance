# DD-062: The test deployment is one free-tier GCP VM with a Neon database, tested by a live suite run on demand

## Decision

The project's test deployment ([SRC-263](SRC-263-the-project-s-test-deployment-runs-on-gcp-and-neon.md)) is described by Terraform scripts in the repository, which the owner applies from their own machine. They create:

- **The machine:** one Compute Engine `e2-micro` virtual machine, the size Google Cloud's free tier covers, in a region the free tier covers, on Google's Container-Optimized OS. At each start it pulls the published application image ([DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md)) and runs it, so restarting the machine or its service updates the tool to the latest image. The tool keeps running between test runs, because with no webhook its re-check ([SC-024](SC-024-re-check-timer.md)) is the only way a change made on GitHub reaches it.
- **HTTPS:** a Caddy container in front of the tool takes a certificate from Let's Encrypt for the machine's host name and passes requests on to the tool. The host name is a domain the owner gives, or, if none is given, the machine's address under sslip.io. Only ports 80 and 443 are open to the internet.
- **The database:** a Neon project on Neon's free plan, whose pooled address is the tool's `database.url` and whose direct address is its `database.directUrl` ([FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md)).
- **The settings and secrets** (the database addresses, the GitHub App's id and key, the personal access token, the first system admin) are given to the machine as instance metadata, which only the Google Cloud project's own users can read. The machine reads them again each time it starts the tool. Terraform's state holds them too, so the state stays on the owner's machine.
- **GitHub access** ([DD-060](DD-060-a-github-function-is-given-an-app-or-a-personal-ac.md)): the GitHub App reads and writes issues (`readIssues`, `writeIssues`), so the tool's issues, comments and reverts show as the App's. A personal access token reads the Projects status field (`projectsStatus`), because a GitHub App cannot read a Project owned by a user account, as a Project of csillagu's is. No webhook is configured, so the deployment's re-check interval is short, 2 minutes unless set otherwise, so that a test does not wait an hour.
- **Stopping:** a Terraform setting stops the machine between test runs and starts it again.

The live test suite ([SRC-264](SRC-264-the-github-side-is-tested-against-a-real-github-re.md)) runs against that deployment, through its REST API, and against a test repository under csillagu, created by the owner, with the App installed on it and a Project with a status field. It signs in as the deployment's first system admin. It acts on GitHub as the owner of a personal access token of its own, standing for the GitHub users the test cases name. Each of its tests carries the id of the test case whose GitHub steps it runs, as the other tests do. Since the deployment is not fresh, each run makes its own project, named after the run, and its own tasks and issues. When it ends, it removes the repository from the run's projects, then deletes the issues and milestones it made on GitHub. The projects stay, since the tool has no way to delete a project; the instance is dedicated to these tests ([SRC-263](SRC-263-the-project-s-test-deployment-runs-on-gcp-and-neon.md)). The suite runs from the owner's machine with one command, and from a GitHub Actions workflow started by hand, with the deployment's address, the admin's credentials and the token as the repository's secrets.

## Alternatives considered

- For the machine: Cloud Run with one instance always running (billed for each hour it runs); Fly.io, which the owner first chose and then replaced with GCP; a GKE cluster.
- For HTTPS: Google's HTTPS load balancer with a managed certificate (billed by the hour); plain HTTP.
- For the database: Cloud SQL (billed); PostgreSQL in a container on the same machine.
- For the secrets: Secret Manager, read by the machine at start.
- For the functions: the App for every function, which cannot read a user's Project; a token for every function, which leaves the App out although the owner asked for it.
- For the tests: against a server the test run starts itself (the owner chose the deployment); with webhooks (the owner chose none).

## Rationale

The owner asked for whatever is cheaper or free ([SRC-263](SRC-263-the-project-s-test-deployment-runs-on-gcp-and-neon.md)). An `e2-micro` machine is in Google Cloud's free tier and keeps the backend, and so its re-check timer, running all the time; Cloud Run, held at one instance, is billed by the hour. Container-Optimized OS runs the published image as it is, with no build on the machine. Caddy obtains and renews a free certificate by itself, where a load balancer is billed by the hour. sslip.io gives the machine a host name without a domain. Neon's free plan holds a small database for nothing, and its pooled and direct addresses fit the tool's two database settings. Instance metadata costs nothing, needs no extra API and no parsing on the machine, and is read only by the project's own users; Secret Manager would add an API, a parser on the machine and its own costs beyond a few secrets.

The App for issues and a token for the Projects status field is the one split that uses both, as the owner asked, and works on a user-owned Project. A short re-check interval stands in for the webhooks the owner chose not to use.

A run's own project keeps its tasks apart from earlier runs', on a deployment that is not fresh. Removing the repository from the project before deleting its issues keeps the tool from recreating them, as it would recreate a linked issue deleted on GitHub ([FR-136](FR-136-treat-a-linked-issue-deleted-on-github-as-closed.md)).

## Trade-offs

- The machine has 1 GB of memory and a shared CPU: enough for one person's tests, not for real use.
- A change to the settings reaches the machine only when its service or the machine is restarted.
- Each run leaves a project behind in the tool.
- The test cases ask for a fresh deployment; on this one, each test sees what earlier runs left, in projects of their own.
- The suite waits for the re-check after each change it makes on GitHub, so it takes minutes, not seconds.

## Risks

- The free tier covers one `e2-micro` machine per billing account, in us-west1, us-central1 or us-east1 only, and its terms may change. An external IPv4 address may be billed, a few dollars a month, whether or not the free tier covers the machine.
- A re-check every 2 minutes keeps Neon's compute awake while the machine runs, which can use up the free plan's compute hours within a month. Stopping the machine between runs avoids it.
- Let's Encrypt limits how many certificates are issued per domain, and sslip.io's names are shared by everyone who uses them. A new machine, which needs a new certificate, may be refused one for a while.
- Terraform's state holds every secret in plain text. Lost or shared, it gives them away.
- The token the suite acts with, and the one the deployment reads Projects with, can do on GitHub what their owners can. Kept as repository secrets, they reach any workflow of the repository that is started by hand.

## Serves

This decision serves [SRC-263](SRC-263-the-project-s-test-deployment-runs-on-gcp-and-neon.md), [SRC-264](SRC-264-the-github-side-is-tested-against-a-real-github-re.md), [DD-040](DD-040-the-tool-ships-as-one-application-image-run-with-p.md), [DD-059](DD-059-settings-come-from-a-yaml-file-overridable-by-envi.md), [DD-060](DD-060-a-github-function-is-given-an-app-or-a-personal-ac.md), [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md).

Origin: issue #225 records the request (SRC-264) and left three questions to the owner, who answered them in the design session of 2026-11-17 (SRC-263). For where to deploy, the owner first chose "Fly.io" over the owner's own server and documentation alone, then "We will use gcp and some terraform scripts for the deployment. Just create it, I will do the deployment locally". For the database, "Neon, also from terraform", over a PostgreSQL app on Fly and Fly's managed PostgreSQL. For the instance, "Dedicated test instance", over one shared with real use. For the test repository, "New repo under csillagu", over another organization's. For what the tests run against, "The deployment", over a server the test run starts itself. For where they run, "Locally + manual CI (Recommended)", over locally only. For GitHub access, "Github app for few things, pat for something else, no webhook", and left which function gets which to Claude: "Truly dont care, please decide." For what runs the container on GCP, "Whatever is cheaper/free". The `e2-micro` machine, Caddy, sslip.io, instance metadata, the split of functions, the re-check interval, the stopping setting, the run's own project and the order of the cleanup are Claude's, as are the wording, alternatives, rationale, trade-offs and risks; they await the owner's confirmation.
