---
certainty: assumed
effort: 3
---

# SC-126: Live GitHub test suite

The test suite that runs the GitHub steps of the test cases against the test deployment and a real test repository ([DD-062](DD-062-the-test-deployment-is-one-free-tier-gcp-vm-with-a.md), [SRC-264](SRC-264-the-github-side-is-tested-against-a-real-github-re.md)), started with one command from the owner's machine. It covers issue creation, the planning mirror (sub-issues, blocked-by, assignees, a milestone's date), closing a cancelled task's issue as not planned, status changes made on GitHub (start and hold through the Projects status field, closing, reopening), the revert of a change that breaks a constraint with its comment, the undoing of a planning edit made on GitHub, a new issue opened on GitHub becoming a task through the webhook, and seeding. It acts on the test repository with a fine-grained personal access token and sets the Project's status field with a classic one. Each test carries the id of the test case it runs. The suite makes its own project, tasks and issues for each run, and removes what it made on GitHub when it ends.

It is done when, run against a deployment set up by SC-125 and a test repository prepared as the README says, every test passes, and the run leaves no open issue and no milestone of its own in the test repository.

Origin: derived by Claude from [DD-062](DD-062-the-test-deployment-is-one-free-tier-gcp-vm-with-a.md) for issue #225. The boundary, name, the test cases chosen and the "done when" are Claude's; it awaits the owner's confirmation. Effort: Claude's estimate; it awaits the owner's confirmation.
