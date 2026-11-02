> **Drafting agent's classification of the initial requirements — frozen record.**
>
> The agent that drafted [initial-requirements.md](initial-requirements.md) with the stakeholder
> was asked which of the 99 SRC items were decisions (DD) and which were source input (SRC),
> based on the drafting conversation. This is its answer, verbatim. In it, "you" is the
> stakeholder (au) and "I", "my" and "Claude's addition" refer to the drafting agent.
> The reqlite items in [`graph/`](../graph/) cite this record. It is not maintained.
>
> - Received: 2026-10-31
> - Item ids refer to the first SRC numbering (SRC-001 to SRC-099), before items were reclassified.

Of the 99 items, 26 are DD, 6 are split, 2 are unknown and 65 are SRC. Some rules I applied:

- **DD:** the alternatives were named in our conversation and you picked one, or you went against my suggested default. When you answered a yes/no question with "yes" or "ok" to my default and the alternative was never discussed, I marked it SRC and said so in Notes.
- **Decisions you delegated to me:** for proposal staleness you asked "what do you propose?", so the options were weighed but the final call was mine. You never explicitly confirmed it, and those rows say so.
- **"Claude's addition":** I put the item into the doc myself. You didn't ask for it and nobody discussed it. You may want to confirm or drop these rather than accept them as given.

| ID | Type | Options weighed | Chosen because | Given up | Notes |
|---|---|---|---|---|---|
| SRC-001 | SRC | | | | Your words: "So self hosted open source is the goal for sure". Stated as a goal after I had suggested trying Plane Cloud. |
| SRC-002 | split | Your first message: "my own backend, or just a github app interacts with the github issues directly" | Not stated ("Probably own backend") | GitHub app working directly on the issues | **Want:** "I want this tool to be the single source of truth, and the GH only be able to start, hold and finish the task." **Choice:** own backend as the store, instead of GitHub issues. |
| SRC-003 | SRC | | | | My proposal ("automatic inside a project, flags across projects"). Your underlying want: "something blocks something then the second thing must happen after the first thing". Automatic rescheduling inside a project was never weighed against an alternative. |
| SRC-004 | split | "automatic leveling of ALL projects" vs "red on over constraining someone" | "That would mean changing someone else project without their approval" | Automatic leveling | **Want:** never change someone else's project without their approval. **Choice:** show red instead of leveling. Extending this to shared milestones was my addition. |
| SRC-005 | DD | Same as SRC-004 | Same as SRC-004 | Same as SRC-004 | The rejected side of the SRC-004 decision. Your words: "what I really dont want is automatic leveling of ALL projects". |
| SRC-006 | SRC | | | | Your words: "AI proposes, and human can edit AND review it in the browser itself, only then does the plan gets overwritten". |
| SRC-007 | SRC | | | | Claude's addition (shared service layer, "no logic duplicated"). No alternative discussed. |
| SRC-008 | SRC | | | | Your words: "Gant page, kanban, thats it basically". The other three views were my additions, derived from later wants. |
| SRC-009 | SRC | | | | You stated it. |
| SRC-010 | SRC | | | | You stated it. |
| SRC-011 | SRC | | | | I proposed it; you said "person load percent is great". |
| SRC-012 | SRC | | | | Your want: "comparing the actual start and end dates to a baseline". The separate view is my addition. |
| SRC-013 | SRC | | | | From your "saved into the tool as unscheduled tasks automatically". The inbox view is my addition. |
| SRC-014 | SRC | | | | Claude's addition, as a way to show your "review it in the browser". No alternative discussed. |
| SRC-015 | split | Email, Slack, in-app (my open question) | Not stated | Email, Slack | **Want:** notifications for red flags and proposals (I raised it, you accepted). **Choice:** "notifications stay in the UI". "Reverted GitHub changes" was my addition. |
| SRC-016 | DD | Same as SRC-015 | Not stated | Email, Slack | Your words: "no 'external' notifications". Same decision as SRC-015. |
| SRC-017 | SRC | | | | Your words: "MCP can read them". API access to notifications was my addition. |
| SRC-018 | DD | PDF or image export (my suggestion, "nice to have, not v1") vs Mermaid | You gave no reason ("gant export -> mermaid?"). I added "renders directly in GitHub" afterwards. | PDF or image export | |
| SRC-019 | SRC | | | | Your words: "GH issues must always have the same constraints as the tool has". |
| SRC-020 | SRC | | | | Your words: "subissue". |
| SRC-021 | SRC | | | | Your words: "blocked by/blocking". |
| SRC-022 | SRC | | | | Your words: "fixed time (for milestones)". |
| SRC-023 | SRC | | | | Claude's addition; the field list was never discussed. |
| SRC-024 | SRC | | | | From your unscheduled-tasks statement. |
| SRC-025 | SRC | | | | Claude's addition; never discussed. |
| SRC-026 | DD | Lag ("yes, optional, default 0", my suggestion) vs no lag | Not stated | Optional lag | Your answer: "2 no". |
| SRC-027 | DD | Working days vs calendar days; whole days vs half days or hours | Not stated | Calendar days; sub-day units | Your answers: "1 working" and "3 whole". |
| SRC-028 | DD | "extend the task's planned finish, or only mark it" | Not stated | Extending the finish | Your answer: "11 yes". I read that as agreeing with "only mark", told you so, and you didn't confirm or correct it. |
| SRC-029 | SRC | | | | Your words: "the who 'can' do it, and the who (or which people) will do it". |
| SRC-030 | SRC | | | | Your words: "A AND (B OR C OR D) etc. 2 deep is enough I would say". |
| SRC-031 | SRC | | | | My proposal; no alternative came up. |
| SRC-032 | SRC | | | | Your words: "the latter needs to be actual list of people". |
| SRC-033 | DD | Hard reject (my suggestion) vs allowed with a warning vs accept | "there are people who can do anything, they are not gonna be written in every task as 'any'" | Reject; warning | Your answer: "no, accept it". |
| SRC-034 | SRC | | | | Claude's addition. Related to your "but still assigned to them". |
| SRC-035 | SRC | | | | My proposal; never discussed. |
| SRC-036 | split | Load as a percentage over the task's duration vs effort hours (I wrote: "Effort-based tasks work the same way if you prefer them") | Your words: "person load percent is great" | Effort-based load | **Want:** "two 50% AI works can be done at the same time (not after each other)". **Choice:** a per-person percentage applied over the whole duration. |
| SRC-037 | DD | "Is load always 100% / AI-adjusted, or can a person be assigned at a custom percentage" | Not stated | Fixed load only | Your answer: "13 yes". |
| SRC-038 | SRC | | | | Your words: "normal tasks will be 100% person load, AI only tasks ... will be 1 or 0% person load". |
| SRC-039 | SRC | | | | Claude's addition, following from your shared-resources want. |
| SRC-040 | DD | Same as SRC-004 | Same as SRC-004 | Automatic leveling | Same decision as SRC-004 and SRC-005. "Capacity" refers to SRC-041. |
| SRC-041 | SRC | | | | I raised it; your words: "ah very good". |
| SRC-042 | SRC | | | | Same as SRC-041. |
| SRC-043 | DD | Whole days vs half days and hours | Not stated | Half days and hours | Your answer: "3 whole". |
| SRC-044 | SRC | | | | Claude's addition, under "capacity and calendars". |
| SRC-045 | SRC | | | | Claude's addition; never discussed. |
| SRC-046 | SRC | | | | My proposal, meeting your "shared resources are needed". |
| SRC-047 | SRC | | | | Claude's detail of the red-flag display. The parent decision is in SRC-004. |
| SRC-048 | SRC | | | | Your want: "shared milestones". The owning-project structure is my proposal. Dependents turning red follows from SRC-004. |
| SRC-049 | SRC | | | | Yes/no question; your answer "17 yes". The alternative was not discussed. |
| SRC-050 | split | A "request a change" flow vs in-app notification only | Not stated | Change-request flow in v1 | **Want:** owners are told about conflicts. **Choice:** no request flow in v1. Your answer: "14 yes". |
| SRC-051 | DD | "can any project with read-write access assign anyone from the pool, or must the person or their lead agree?" | Not stated | The person's or their lead's agreement | Your words: "any project can assign anyone, IF they have read access". You confirmed my reading of "they". |
| SRC-052 | DD | Exact task details vs only "busy, 60%" | Not stated | Showing a percentage only, everywhere | Your words: "They should be able to see the exact task on projects they have read rights to". |
| SRC-053 | SRC | | | | Your words: "comparing the actual start and end dates to a baseline is something we need too". |
| SRC-054 | unknown | | | | I named two options: baseline custom fields, or "several baselines ... as snapshots". I then chose multiple snapshots myself when writing the doc. You never weighed in. |
| SRC-055 | SRC | | | | My proposal; no alternative weighed. |
| SRC-056 | SRC | | | | Same as SRC-055. |
| SRC-057 | SRC | | | | My statement; no alternative weighed. |
| SRC-058 | SRC | | | | Your words: "GH only be able to start, hold and finish the task". |
| SRC-059 | SRC | | | | Same as SRC-058. |
| SRC-060 | SRC | | | | Same as SRC-058. |
| SRC-061 | SRC | | | | Your words: "GH issues are only created directly by third parties, or non plannable things, like bugs etc". |
| SRC-062 | DD | "labels, a Projects status field, assignment" | Not stated | Labels, assignment | Your words: "start and hold: project status." "Finish is closing the issue" was never weighed against anything. |
| SRC-063 | SRC | | | | Your words: "GH issues must always have the same constraints as the tool has". Mirroring assignees and fixed dates was my addition. |
| SRC-064 | SRC | | | | Your words: "task assignments, planning only happens in the tool". |
| SRC-065 | DD | Revert the GitHub change vs accept it and flag it red (the comment thread) | Not stated | Accept and flag red | Your words: "tool reopens/recreates it". |
| SRC-066 | SRC | | | | From your issue-creation statement. "The tool creates the issues" was my addition. |
| SRC-067 | SRC | | | | My proposal; your answer "4 ok". No alternative raised. |
| SRC-068 | DD | Cancel the task (my suggestion) vs keep it | "a random user on github should not be able to cancel tasks in a plan" | Cancelling from GitHub | Your words: "I want the task to be kept". Reopening the issue is my implementation, consistent with SRC-065. |
| SRC-069 | SRC | | | | Your answer: "6 yes". This is also how GitHub behaves when a PR closes an issue. |
| SRC-070 | SRC | | | | Your answer: "9 ok". |
| SRC-071 | SRC | | | | Your answer: "8 ok". |
| SRC-072 | DD | Per-project repo mapping set by the project admin (my suggestion) vs assume it | Your words: "this is irrelevant" | Mapping rules | Your words: "tool can just assume that every issue is in a project". I asked whether "project" meant the GitHub Project, and that is still unanswered. |
| SRC-073 | SRC | | | | Your answer: "10 ok". |
| SRC-074 | SRC | | | | Your words: "GH import (or seeding the thing from GH) IS needed". |
| SRC-075 | unknown | | | | I asked whether GitHub Projects date fields should be imported as planned dates. Your answer covered only closed issues. |
| SRC-076 | DD | Open issues only (my suggestion) vs closed too | Not stated | Importing open issues only | Your words: "nono, closed too. Closing dates from gh project field". Where the closing date comes from was not weighed. |
| SRC-077 | SRC | | | | Your words: "normal api+mcp". |
| SRC-078 | SRC | | | | Claude's addition, as a way to enforce your "AI proposes". |
| SRC-079 | SRC | | | | Your want; my wording. |
| SRC-080 | SRC | | | | Your words: "human can edit AND review it in the browser". |
| SRC-081 | SRC | | | | Your words: "only then does the plan gets overwritten". |
| SRC-082 | DD | Storing changes with base values, including computed dates ("finish: 12 Nov → 19 Nov"), vs storing inputs only | "False conflicts everywhere" from automatic rescheduling (my reason) | Storing computed values | You asked "what do you propose?" and then doubted it: "rebasing, I am not sure if this one will be successful tbh". I revised it, and you never explicitly confirmed the revision. |
| SRC-083 | DD | Same as SRC-082 | Same as SRC-082 | Same as SRC-082 | Part of the same revision. |
| SRC-084 | DD | A conflict whenever a stored base value changes vs only when the same input on the same task was edited | False conflicts (my reason) | Base-value conflicts | Same caveat as SRC-082. |
| SRC-085 | DD | Approving changes individually (first version) vs grouped | "Proposed changes often only make sense together" (my reason) | Per-change approval | Same caveat as SRC-082. |
| SRC-086 | SRC | | | | Mine, present in both versions; never contested. |
| SRC-087 | SRC | | | | Part of my revision; this element wasn't weighed against an alternative. |
| SRC-088 | DD | 14 days (my suggestion) vs 24 hours | Not stated | 14 days | Your answer: "15 24h". |
| SRC-089 | DD | "Can one proposal span several projects, or must it be split so each project approves its own part?" | Not stated | Splitting proposals per project | Your answer: "16 ookay". |
| SRC-090 | DD | Global roles vs per-project roles | Not stated | Global roles | Your words: "roles are per project." |
| SRC-091 | SRC | | | | Your words: "read only, read write, admin". |
| SRC-092 | SRC | | | | Same as SRC-091. |
| SRC-093 | SRC | | | | Same as SRC-091. The project-level scope is my wording. |
| SRC-094 | SRC | | | | Claude's addition. |
| SRC-095 | SRC | | | | Your answer: "18 yes". The alternative was not discussed. |
| SRC-096 | DD | GitHub OAuth, OIDC/SSO, local accounts | Not stated | GitHub OAuth, SSO (for now) | Your words: "I would go for local accounts, maybe later we will ahve sso." |
| SRC-097 | SRC | | | | Your words: "no self login, sysadmin adds access". |
| SRC-098 | DD | A system-admin role creates projects (my question) vs anyone with access | Not stated | Only system admins create projects | Your words: "projects can be created by anyone having access to the system". "Becomes its admin" is my addition and wasn't discussed. |
| SRC-099 | SRC | | | | Your words: "is just installed to repos by the repo admin". This is also how GitHub Apps are installed. |

The build-vs-adopt choice (Plane, OpenProject, or building your own) was clearly weighed, but none of the 99 items records it. You may want to add it as its own DD.
