# DD-064: Demo projects are seeded by a hand-started workflow that deletes the live tests' projects in the database, then runs a seed script over the REST API

## Decision

The test deployment's projects are reset to the demo projects ([SRC-279](SRC-279-demo-projects-are-seeded-into-the-test-deployment-.md)) by a GitHub Actions workflow with two steps:

- **Deleting the live tests' projects:** the live tests' projects are those named `<label> live-YYYY-MM-DD-HH-MM-<4 hex digits>`, after their run ([DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md)). The tool cannot delete a project, so the workflow gets the database's address from Neon's API with the Neon API key and deletes them with one SQL script, in one transaction. No foreign key to a project cascades, so the script finds the rows that refer to a project from the database's own foreign keys, not from a list it keeps, and deletes them, each table's referring rows before its own. A table added later is covered with no change to the script. The projects' audit log entries go with them. An AI proposal that touches one of them is deleted whole. No other project, account, group or repository is touched. Notifications, which name a project only inside their content, are left in place.
- **Creating the missing demo projects:** the seed script attached to issue #257, unchanged, run over the REST API as the first system admin. It checks that the 30 demo accounts exist and stops, changing nothing, if one is missing. It creates each demo project that does not exist, found by name, and leaves one that exists as it is.

The workflow is started by hand only, and shares the live GitHub tests' concurrency group, so it never deletes projects a live run is working in. It runs in a GitHub environment of its own, `demo` ([SRC-280](SRC-280-the-demo-seeding-runs-in-an-environment-of-its-own.md)), which the deployment's Terraform writes as it writes `live`: the deployment's address, its first system admin's name and password, and the Neon project, database, role and API key. The API key is a Terraform variable of its own, for now the key Terraform itself uses. The environment's required reviewer is the owner, switched on by a Terraform variable once the repository is public: until then GitHub's free plan refuses it.

The 30 demo accounts were created once, by hand, on 2026-11-23 ([SRC-281](SRC-281-the-30-demo-accounts-are-created-now-with-long-ran.md)), with 48 random characters for each password. The passwords are kept on the owner's machine, in a file beside Terraform's state, which git ignores.

## Alternatives considered

- For deleting: through the tool, which has no way to delete a project; a list of the tables that refer to a project, kept in the script, which a new table would silently break; changing the foreign keys to cascade, a schema change of the product for the sake of a test bed; deleting through Neon's pooled address rather than its direct one.
- For proposals: deleting only their rows for the doomed projects, which would leave a proposal with some of its projects gone.
- For when it runs: on each deployment, or on a schedule, either of which could delete a live run's projects while it works in them.
- For the passwords: Terraform generating them, which cannot create accounts in the tool; a step of the workflow creating the accounts, which the owner's answer ruled out.
- For the approval: waiting until the repository is public before the environment exists (the owner chose no reviewer until then); a paid GitHub plan.

## Rationale

The owner asked for the deletion to use the Neon API key, and the tool cannot delete a project, so the database is the only way. Reading the foreign keys from the database keeps the deletion correct as tables are added, which a list would not. Sharing the live tests' queue keeps a reset from breaking a run. A separate environment lets the owner approve each reset, which destroys data, without putting an approval gate on the live tests, which the owner chose not to have.

## Trade-offs

- The deletion bypasses the tool: it writes no audit log entry of its own, and the deleted projects' audit log entries go with them.
- Until the repository is public, a run needs no approval; only the owner, the only collaborator, can start one.
- Notifications about a deleted project stay in their readers' lists.
- A project a person names like a live run's is deleted too.

## Risks

- A foreign key over more than one column, or a chain of references deeper than 20 tables, stops the script, which then deletes nothing.
- GitHub keeps one waiting run in a concurrency group: a third arriving run cancels the one waiting.

## Serves

This decision serves [SRC-279](SRC-279-demo-projects-are-seeded-into-the-test-deployment-.md), [SRC-280](SRC-280-the-demo-seeding-runs-in-an-environment-of-its-own.md), [SRC-281](SRC-281-the-30-demo-accounts-are-created-now-with-long-ran.md), [DD-062](DD-062-the-test-deployment-is-a-cloud-run-service-scaled.md).

Origin: issue #257 records the request (SRC-279); the owner set the environment and accepted the plan (SRC-280), and had the accounts created (SRC-281), in the design session of 2026-11-23. The deletion by the database's foreign keys, the whole proposals, the start by hand, the shared queue, the environment's name, the Neon key's own variable and where the passwords are kept are Claude's, as are the wording, alternatives, rationale, trade-offs and risks; they await the owner's confirmation.
