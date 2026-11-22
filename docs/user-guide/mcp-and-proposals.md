# AI proposals and the MCP server

An AI assistant can read the plan and propose changes to it, but it never changes the plan by itself. Every change it suggests arrives as a **proposal**, which a person reviews in the browser as a live preview, edits if needed, and approves or rejects. Only an approved proposal changes the plan.

- [How it works](#how-it-works)
- [Connect an AI assistant over MCP](#connect-an-ai-assistant-over-mcp)
- [The MCP tools](#the-mcp-tools)
- [The proposal format](#the-proposal-format)
- [Reviewing a proposal](#reviewing-a-proposal)
- [Rules worth knowing](#rules-worth-knowing)

## How it works

1. The AI reads the plan through the MCP server (or the [REST API](rest-api.md)) and creates a proposal: groups of changes, such as new tasks, date moves, assignments and dependencies.
2. The people who can review it are notified. The project's Kanban and Gantt show the pending changes as dashed overlays.
3. A reviewer opens the proposal. The tool applies it to the current plan in memory, reschedules, and shows what would change, and any red flags the proposal would raise. The live plan is not touched.
4. The reviewer edits or drops groups of changes, then approves or rejects. On approval, all its changes are applied together, in one step.

## Connect an AI assistant over MCP

The MCP server is part of the tool, at `<the tool's address>/mcp`. It uses the MCP *Streamable HTTP* transport and authenticates with a personal access token.

1. **Choose whose token it is.** The AI acts with that account's roles. To create proposals in a project, the account needs the **read-write** or **admin** role there. Many teams create a dedicated account for the assistant, with read-write access to the projects it plans in. Approved changes are always recorded under the person who approved them.
2. **Create a token** for that account under **Your account → API tokens**, ideally with an expiry date. Copy it: it is shown only once.
3. **Add the server to your MCP client**, with the token as a bearer token in the `Authorization` header.

   In Claude Code:

   ```sh
   claude mcp add --transport http cold-seance https://planning.example.com/mcp \
     --header "Authorization: Bearer <token>"
   ```

   In a client configured with JSON, such as a project's `.mcp.json`:

   ```json
   {
     "mcpServers": {
       "cold-seance": {
         "type": "http",
         "url": "https://planning.example.com/mcp",
         "headers": { "Authorization": "Bearer <token>" }
       }
     }
   }
   ```

   Any MCP client that supports Streamable HTTP and a custom header works the same way.

A request without a working token is refused with `401`. A browser sign-in does not work for the MCP server: it needs a token.

## The MCP tools

| Tool | Arguments | What it does |
| --- | --- | --- |
| `list_projects` | none | Lists the projects the token's account can read, by id and name. |
| `read_plan` | `projectId` | Reads a project's tasks, with all their fields, and each task's relations: parent, subtasks, blocked by. |
| `read_notifications` | none | Reads the account's notifications, newest first, without marking them. |
| `create_proposal` | `groups` | Creates a proposal from groups of changes, for people to review. |

The server offers nothing else. It cannot change the plan directly, nor approve, edit or reject a proposal. The answers have the same shape as the REST API's for the same thing, and a refusal comes back as a tool error whose text is the REST API's error, with the reason in plain words.

## The proposal format

A proposal is a list of **groups**, and each group is a list of **changes**. A group holds changes that only make sense together. Reviewers keep, edit or drop a group as a whole.

```json
{
  "groups": [
    {
      "changes": [
        {
          "kind": "create-task",
          "key": "docs",
          "projectId": "1b7e…",
          "fields": { "title": "Write the user guide", "plannedStart": "2026-12-01", "durationWorkingDays": 4 }
        },
        {
          "kind": "add-blocker",
          "task": { "taskId": "9c02…" },
          "blocker": { "newTask": "docs" }
        }
      ]
    },
    {
      "changes": [
        { "kind": "update-task", "task": { "taskId": "4f1a…" }, "fields": { "aiShare": 50 } }
      ]
    }
  ]
}
```

The kinds of change:

| `kind` | Other keys | Does |
| --- | --- | --- |
| `create-task` | `key`, `projectId`, `fields` (with a `title`) | Creates a task. `key` is a name of your choice, for other changes in the same group to refer to it. |
| `update-task` | `task`, `fields` | Changes a task's fields. |
| `set-parent` | `task`, `parent` (a task, or `null`) | Makes the task a subtask, or a top-level task again. |
| `add-blocker` | `task`, `blocker` | Makes `task` blocked by `blocker`. |
| `remove-blocker` | `task`, `blocker` | Removes that relation. |
| `set-status` | `task`, `status` (`in-progress`, `on-hold` or `done`) | Sets the task's status. |
| `cancel-task` | `task` | Cancels the task. |
| `assign-repository` | `task`, `repositoryId` | Assigns the task to a repository, which creates its GitHub issue once approved. |

A task is named as `{ "taskId": "<id>" }`, or as `{ "newTask": "<key>" }` for one that a `create-task` change in the same group creates.

`fields` are the task fields the [REST API](rest-api.md#examples) takes: `title`, `description`, `plannedStart`, `plannedFinish`, `durationWorkingDays`, `effort`, `aiShare`, `personLoad`, `milestone` (only in `create-task`), `eligibility`, `assignees` and `loadOverrides`. The values are checked when the proposal is previewed and applied, against the same rules as any other change. A milestone, for instance, is created with `"milestone": { "variant": "fixed-date", "date": "2026-12-18" }` or `{ "variant": "floating" }`.

A proposal holds only these inputs, never dates the scheduler works out. That is why it rarely goes stale: its preview is always worked out again against the plan as it is now.

## Reviewing a proposal

Open it from the notification, from the line above the project's Kanban or Gantt, or from the project's **Proposals** tab.

The proposal's page shows:

- **The preview:** each task the proposal would change, before and after, including tasks that the scheduler would move as a result, and every red flag it would newly raise. It is worked out afresh each time you open the page.
- **Conflicts:** changes to a task input that someone else has edited since the proposal was made. Resolve a conflict by editing its group, or drop the group.
- **The groups of changes**, each with **edit** and **drop**. Editing a group lets you type its values anew or leave a change out. Nothing reaches the plan until approval.
- **Approve** and **reject.**

**Approving.** Approve each project's part you are allowed to: you need the read-write or admin role in that project. You approve against the preview you are looking at. If the plan changed in the meantime, nothing is approved: the page shows the refreshed preview and what changed, and asks you to confirm again. Once every project the proposal changes has approved its part, all its changes are applied together, or none of them. A change that can no longer be made, such as a date that is now a non-working day, is refused and named, and nothing is applied.

**Rejecting** rejects the whole proposal, after a second click to confirm. If a proposal no longer makes sense, reject it and ask the AI for a new one.

## Rules worth knowing

- **Proposals change tasks only:** their fields, relations, status, cancellation and repository. A proposal that touches anything else, such as members, roles, calendars or settings, is refused.
- **Proposals come from the MCP server or the REST API,** not from the browser. People change the plan directly.
- **Only read-write members and admins** of every project a proposal changes can create it.
- **A proposal can span several projects.** Each project approves its own part, and the proposal is applied only when every part is approved. Approvals already given stay valid if the plan changes later.
- **Who sees it:** a proposal is shown only to people with a role in every project it changes.
- **Proposals expire** 24 hours after they were last edited, by the AI or a person. An expired proposal can no longer be approved.
- **The audit log** records each applied change under the person who approved it, with both the proposal's channel (MCP server or REST API) and the approval's.

**Tips for working with an AI assistant:**

- Ask it to call `read_plan` first, and to group changes that belong together, so that you can keep or drop them as a unit.
- Ask for durations, dependencies and fixed dates rather than exact dates for every task. The scheduler works out the rest, and the proposal stays valid as the plan moves.
- After approving, ask it to read the plan again before its next proposal.
