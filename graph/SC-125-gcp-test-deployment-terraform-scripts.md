---
certainty: assumed
effort: 3
---

# SC-125: GCP test deployment Terraform scripts

The Terraform scripts that set up the project's test deployment ([DD-062](DD-062-the-test-deployment-is-one-free-tier-gcp-vm-with-a.md)): the Neon project and its database; on Google Cloud, the `e2-micro` machine on Container-Optimized OS with its static address and firewall rule, and the start-up configuration that runs the application image behind Caddy with the settings and secrets read from the machine's metadata; and a setting to stop the machine and start it again. The scripts take the Google Cloud project, the Neon API key, the GitHub App's id and key file, the personal access token for the Projects status field and the first system admin as variables, with an example variables file, and give the deployment's address as output. The deliverable also covers the README's instructions for applying them, updating the deployment and stopping it, and what the test repository and the GitHub App need.

It is done when `terraform validate` passes on the scripts, and, applied to an empty Google Cloud project with a Neon API key, they bring up a deployment that answers the REST API over HTTPS at the address they output and signs in its first system admin.

It delivers:

- [FR-177](FR-177-use-the-postgresql-database-given-in-the-configura.md): Use the PostgreSQL database given in the configuration

Origin: derived by Claude from [DD-062](DD-062-the-test-deployment-is-one-free-tier-gcp-vm-with-a.md) for issue #225. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
