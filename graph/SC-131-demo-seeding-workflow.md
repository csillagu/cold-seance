---
certainty: assumed
effort: 2
---

# SC-131: Demo seeding workflow

The GitHub Actions workflow, started by hand only, that resets the test deployment's projects to the demo projects ([DD-064](DD-064-demo-projects-are-seeded-by-a-workflow-that-delete.md)): the SQL script that deletes the live tests' projects with every row that refers to them, run on the deployment's Neon database at the address Neon's API gives; the seed script attached to issue #257, which checks the demo accounts and creates the missing demo projects over the REST API; the `demo` GitHub environment, written by the deployment's Terraform scripts (SC-125), with its settings and secrets and the owner as its required reviewer once switched on; an integration test of the deletion; and the developer documentation's section on it.

It is done when the integration test shows a live test project deleted with every row that refers to it while other projects keep theirs, the workflow stops naming any setting that is missing, and a run on the test deployment leaves no live test project and every demo project in place.

Origin: derived by Claude from [DD-064](DD-064-demo-projects-are-seeded-by-a-workflow-that-delete.md) for issue #257. The boundary, name and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
