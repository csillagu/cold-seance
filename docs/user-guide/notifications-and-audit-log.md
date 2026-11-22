# Notifications and the audit log

## Notifications

Notifications are in the app only: there is no email, Slack or other outside channel. Open them under **Your account → Notifications**. They are listed newest first, and each leads to what it is about. Reading them leaves them in place. The [REST API](rest-api.md) and the [MCP server](mcp-and-proposals.md#the-mcp-tools) can read them too.

| You are notified of | When you are |
| --- | --- |
| A new **red flag** (overload, unavailable assignee, pushed milestone, cross-project dependency) | Subscribed to the project or to the task's issue |
| Another project's milestone moving past the start of a task that depends on it | An admin of either project |
| A **proposal waiting for review** | Read-write or admin in a project the proposal changes |
| A **change the tool reverted on GitHub** | Subscribed to the project or to the task's issue |
| A project's **request to add a repository** | An admin of that repository |
| A GitHub **token that GitHub refused**, expired or revoked | A system admin |

### Subscriptions

- **Projects:** the control beside a project's name subscribes you to it, and unsubscribes you. Read-write members and admins are subscribed to their projects automatically, and cannot unsubscribe while they hold that role.
- **Issues:** on the page of a task that has a GitHub issue, the same control subscribes you to that issue alone.

The bottom of the notifications page lists your subscriptions, each with the control that ends it.

## The audit log

Every change is recorded: who made it, when, through which channel (the UI, the REST API, the MCP server or GitHub) and what it changed.

- **A project's audit log** is on its **Audit log** tab. The project's read-write members and admins can read it.
- **The whole log**, across every project, is under **Administration → Audit log**, for system admins only.

Some entries are worth knowing how to read:

- **Changes from an approved proposal** are recorded under the person who approved them, with both channels: the one the proposal came through (MCP server or REST API) and the one it was approved through, the UI when it was approved in the browser.
- **Changes from GitHub** are recorded under the GitHub login of whoever made them, through the GitHub channel. A change the re-check found, where GitHub names no one, is recorded under `(re-check)`.
