---
certainty: verified
source: design session
evidence: design session 2026-11-27; GitHub issue 245
---

# SRC-297: The re-check also takes in issues it does not know yet, opened since their repository was added to the project that receives them

Each re-check also lists the issues of the repositories that projects pull issues from, and takes in each issue the tool does not know yet as if it had just been opened. It does so always, whether a webhook is configured or not, so a missed or failed delivery is caught too. An issue already closed when it is found is taken in as a done task, with its closing date as its actual finish, as seeding does. Only issues opened since the repository was added to the project that receives them are taken in; older issues are left to seeding.

As received, in GitHub issue #245, which the owner opened: "The tool should see GitHub issues even when no webhook reaches it: a new issue opened on GitHub should become a task without a webhook too."

As received, in the design session of 2026-11-27, on issue #245:

- Asked how the tool should find new issues when no webhook reaches it, with the options "Re-check lists repos" ("On each run, the re-check also lists the issues in every repository a project pulls from. Any issue it doesn't know yet is taken in as if it had just been opened") and "Separate poller": "Re-check lists repos (Recommended)".
- Asked whether to look for new issues only when no webhook is configured, or always, with "Always" offered as "Always look, even when webhooks are configured. A missed or failed delivery is then caught too": "Always (Recommended)".
- Asked whether an issue the tool has not seen, found already closed, is taken in, with "Closed too, as done" offered as "Also take in closed issues, as done tasks with their closing date as the actual finish, the way seeding does": "Closed too, as done".
- Asked how far back to look, with the options "Since repo was added" and "Every issue": "Every issue". This was overtaken in the same session, below.
- Told that with every issue, the next re-check after a repository is added to a project takes in all its existing issues as plain tasks, without their relations or assignees, and that seeding then skips them as already in the project, and asked whether to keep it, with the options "Keep every issue", "Only issues opened since" and "Every issue, after seeding": "Only issues opened since", offered as "Take in only issues opened after the repository was added to the project that receives them. Existing issues are left to seeding, which keeps its relations and assignees."

Not stated: whether a repository counts as added to a project when the project asks for it or when the request is approved, and, for a project that stopped pulling from a repository and pulls from it again, whether "since" counts from the first or the latest addition.
