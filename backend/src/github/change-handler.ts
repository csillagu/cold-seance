import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { defaultStatusField, type StatusFieldConfig } from '../config/config.ts'
import type { Database } from '../db/client.ts'
import { repositories, taskBlockedBy, taskIssues, tasks } from '../db/schema.ts'
import type { ISSUE_SEEN_STATES } from '../db/schema.ts'
import type { GitHubUser } from '../service/audit.ts'
import { type GitHubIssueTaskService, lockIssueLinks } from '../service/github-issue-tasks.ts'
import type { TaskStatus } from '../service/permissions.ts'
import type { PlanningChanges } from '../service/planning-changes.ts'
import type { TaskCancellationService } from '../service/task-cancellation.ts'
import type { TaskStatusService } from '../service/task-status.ts'
import type { Repository } from './app-tokens.ts'
import { GitHubRequestError, type GitHubClient } from './client.ts'
import { numberField, objectField, stringField } from './json.ts'
import { agreed, type ProjectItem, readProjectItems, same } from './project-items.ts'

type SeenState = (typeof ISSUE_SEEN_STATES)[number]

/** A task's linked issue, as the handler finds it from the issue GitHub names. */
interface LinkedTask {
  taskId: string
  title: string
  status: TaskStatus
  repositoryId: string
  githubId: number
  /** What the handler last took in of the issue (SC-023). */
  seenState: SeenState
  seenStatus: string | null
  /** Whether the task's project still pulls issues from the issue's repository (FR-182). */
  synced: boolean
}

/** The issue as GitHub answers it now. */
type IssueNow =
  { state: 'open' | 'closed' | 'not-planned'; items: ProjectItem[] } | { state: 'deleted' }

/** The parts of the service layer the handler makes its changes through (DD-039). */
export interface ChangeHandlerServices {
  githubIssueTasks: GitHubIssueTaskService
  taskCancellation: TaskCancellationService
  taskStatus: TaskStatusService
}

export interface ChangeHandlerOptions {
  /** The Projects status field start and hold come from (SRC-252); `Status`, `In Progress`, `On Hold` unless given. */
  statusField?: StatusFieldConfig
}

const SET_OPTION = `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(
    input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }
  ) { projectV2Item { id } }
}`

const CLEAR_OPTION = `mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(
    input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }
  ) { projectV2Item { id } }
}`

/**
 * The GitHub change handler (SC-023): it handles each change to an issue that reaches the tool
 * from GitHub, by a webhook (SC-105) or found by the re-check (SC-024). It is told which issue
 * changed and who changed it, and reads the issue as it is now; it acts on what changed since it
 * last took the issue in (`task_issues.seen_state`, `seen_status`), so that a change it is told of
 * twice, or late, is handled once, and a status set in the tool is not set back from an issue
 * that has not changed on GitHub.
 *
 * - **Status from GitHub.** A move of the issue in the configured Projects status field
 *   (SRC-252, DD-015) to the started option starts the task, or sets it back in progress from on
 *   hold (FR-091); to the on-hold option, puts it on hold (FR-092). Closing the issue finishes the
 *   task (FR-093), and so does deleting it (FR-136); closing it as not planned cancels it
 *   (FR-096); reopening it sets a finished task back to in progress (FR-094). Each is made through
 *   the service layer whatever the GitHub user's role in the tool, or none (FR-099), and recorded
 *   under their GitHub login (SRC-251). An issue in several Projects whose status options differ
 *   is taken as moved to none of them.
 * - **Reverts.** A change the service layer refuses, because it breaks a constraint (FR-095,
 *   DD-032) or the task cannot be cancelled, is reverted on GitHub: a start is reset to the option
 *   last taken in (none, if there was none); a closed issue is reopened; a deleted one is created
 *   again in its repository, with the task's title, and linked to the task in its place; a reopen
 *   the task cannot follow is closed again.
 * - **Planning edits** made on GitHub are undone (FR-097): the planning mirror (SC-022) mirrors
 *   again the issue's task, the tasks GitHub now shows as its sub-issues or as blocked by it, and
 *   the task's own subtasks and the tasks it blocks.
 * - **New issues** become unscheduled tasks in the repository's receiving project (FR-100,
 *   FR-156, FR-157), through `issueOpened`.
 *
 * The issues of tasks a project kept after its approval for the repository was withdrawn are
 * ignored (FR-182). Changes are dealt with one at a time.
 */
export class GitHubChangeHandler {
  readonly #db: Database
  readonly #github: () => GitHubClient
  readonly #mirror: PlanningChanges
  readonly #services: ChangeHandlerServices
  readonly #field: StatusFieldConfig
  #queue: Promise<void> = Promise.resolve()

  /**
   * `github` is called when the handler first calls GitHub; `mirror` is the GitHub planning mirror
   * (SC-022), told of each task whose planning is to be restored on GitHub.
   */
  constructor(
    db: Database,
    github: () => GitHubClient,
    mirror: PlanningChanges,
    services: ChangeHandlerServices,
    options: ChangeHandlerOptions = {},
  ) {
    this.#db = db
    this.#github = github
    this.#mirror = mirror
    this.#services = services
    this.#field = options.statusField ?? defaultStatusField
  }

  /**
   * Handles a change to issue `number` of `repository` that the GitHub user `sender` made.
   * Resolves once the change is taken in or reverted and the planning mirror is told of the tasks
   * to mirror again; rejects with what GitHub refused, for the re-check to put right (DD-051).
   */
  issueChanged(repository: Repository, number: number, sender: string): Promise<void> {
    return this.#enqueue(() =>
      this.#changed(repository, number, { githubLogin: sender, channel: 'github' }),
    )
  }

  /**
   * Handles issue `number` of `repository` opened on GitHub by `sender`: adds it to the
   * repository's receiving project as an unscheduled task (FR-100, FR-157), unless it is linked to
   * a task already, is a pull request, or no project is to receive it.
   */
  issueOpened(repository: Repository, number: number, sender: string): Promise<void> {
    return this.#enqueue(() =>
      this.#opened(repository, number, { githubLogin: sender, channel: 'github' }),
    )
  }

  #enqueue(work: () => Promise<void>): Promise<void> {
    const run = this.#queue.then(work)
    this.#queue = run.catch(() => {})
    return run
  }

  async #opened(repository: Repository, number: number, user: GitHubUser): Promise<void> {
    const repositoryId = await this.#repositoryId(repository)
    if (repositoryId === undefined) return
    const client = this.#github()
    const { data } = await client.rest('readIssues', repository, {
      method: 'GET',
      path: ['issues', number],
    })
    if (objectField(data, 'pull_request') !== undefined) return
    const githubId = numberField(data, 'id')
    if (githubId === undefined) throw new Error('GitHub answered an issue without its id')
    const taskId = await this.#services.githubIssueTasks.createFromIssue(user, {
      repositoryId,
      number,
      githubId,
      title: stringField(data, 'title') ?? '',
    })
    if (taskId !== null) this.#mirror.changed([taskId])
  }

  async #changed(repository: Repository, number: number, user: GitHubUser): Promise<void> {
    const linked = await this.#linked(repository, number)
    if (linked === undefined || !linked.synced) return
    const client = this.#github()
    const now = await this.#read(client, repository, number)
    let seenState = linked.seenState
    let seenStatus = linked.seenStatus
    let exists = now.state !== 'deleted'
    let open = now.state === 'open'
    let recreated = false

    if (now.state !== linked.seenState) {
      const outcome = await this.#takeState(user, linked, now.state)
      if (outcome === 'taken') seenState = now.state
      else if (now.state === 'deleted') {
        await this.#recreate(client, repository, linked)
        recreated = true
        exists = true
      } else if (now.state === 'open') {
        await this.#setState(client, repository, number, { state: 'closed' })
        open = false
      } else {
        await this.#setState(client, repository, number, { state: 'open' })
        open = true
      }
    }

    if (open && now.state !== 'deleted') {
      const value = agreed(now.items)
      if (value !== undefined && value !== seenStatus) {
        const taken = await this.#takeStatus(user, linked.taskId, value)
        if (taken) seenStatus = value
        else await this.#resetStart(client, repository, now.items, seenStatus)
      }
    }

    // A re-creation stored what it took in with the new link.
    if (!recreated && (seenState !== linked.seenState || seenStatus !== linked.seenStatus)) {
      await this.#db
        .update(taskIssues)
        .set({ seenState, seenStatus })
        .where(and(eq(taskIssues.taskId, linked.taskId), eq(taskIssues.githubId, linked.githubId)))
    }

    const onGitHub =
      now.state === 'deleted' ? [] : await this.#relatedOnGitHub(client, repository, number)
    const related = await this.#relatedInTool(linked.taskId, onGitHub)
    this.#mirror.changed(exists ? [linked.taskId, ...related] : related)
  }

  /**
   * Takes in the issue's new state through the service layer: `taken`, or `refused` for a change
   * the task cannot follow, which is then reverted on GitHub.
   */
  async #takeState(
    user: GitHubUser,
    linked: LinkedTask,
    state: SeenState,
  ): Promise<'taken' | 'refused'> {
    const { taskStatus, taskCancellation } = this.#services
    const done = linked.status === 'done'
    const closed = done || linked.status === 'cancelled'
    if (state === 'closed' || state === 'deleted') {
      if (closed) return 'taken'
      const outcome = await taskStatus.setStatusFromGitHub(user, linked.taskId, 'done')
      return outcome === 'refused' ? 'refused' : 'taken'
    }
    if (state === 'not-planned') {
      if (closed) return 'taken'
      const outcome = await taskCancellation.cancelFromGitHub(user, linked.taskId)
      return outcome === 'refused' ? 'refused' : 'taken'
    }
    // Reopened: a finished task is set back in progress (FR-094); any other is left as it is.
    if (!done) return 'taken'
    const outcome = await taskStatus.setStatusFromGitHub(user, linked.taskId, 'in-progress')
    return outcome === 'refused' ? 'refused' : 'taken'
  }

  /**
   * Takes in a move of the issue to the status option `value`: answers false for a start the
   * task's relations forbid, which is then reset on GitHub; true otherwise. Only an open task
   * follows: started sets a task that is not started or on hold in progress, on hold puts one that
   * is not started or in progress on hold; any other option means neither.
   */
  async #takeStatus(user: GitHubUser, taskId: string, value: string | null): Promise<boolean> {
    const [task] = await this.#db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
    if (task === undefined || value === null) return true
    const { taskStatus } = this.#services
    if (
      same(value, this.#field.started) &&
      (task.status === 'not-started' || task.status === 'on-hold')
    ) {
      return (await taskStatus.setStatusFromGitHub(user, taskId, 'in-progress')) !== 'refused'
    }
    if (
      same(value, this.#field.onHold) &&
      (task.status === 'not-started' || task.status === 'in-progress')
    ) {
      await taskStatus.setStatusFromGitHub(user, taskId, 'on-hold')
    }
    return true
  }

  /**
   * Sets each of the issue's items that is in the started option back to `previous`, or clears it
   * if there was none or its Project has no such option (FR-095).
   */
  async #resetStart(
    client: GitHubClient,
    repository: Repository,
    items: readonly ProjectItem[],
    previous: string | null,
  ): Promise<void> {
    for (const item of items) {
      if (item.value === null || !same(item.value, this.#field.started) || item.field === undefined)
        continue
      const option =
        previous === null ? undefined : item.field.options.find((o) => o.name === previous)
      const ids = { projectId: item.projectId, itemId: item.itemId, fieldId: item.field.id }
      if (option === undefined)
        await client.graphql('projectsStatus', repository, CLEAR_OPTION, ids)
      else
        await client.graphql('projectsStatus', repository, SET_OPTION, {
          ...ids,
          optionId: option.id,
        })
    }
  }

  async #setState(
    client: GitHubClient,
    repository: Repository,
    number: number,
    body: { state: 'open' | 'closed' },
  ): Promise<void> {
    await client.rest('writeIssues', repository, {
      method: 'PATCH',
      path: ['issues', number],
      body,
    })
  }

  /** The registered repository's id, if it is registered. */
  async #repositoryId(repository: Repository): Promise<string | undefined> {
    const [row] = await this.#db
      .select({ id: repositories.id })
      .from(repositories)
      .where(
        and(
          eq(sql`lower(${repositories.owner})`, repository.owner.toLowerCase()),
          eq(sql`lower(${repositories.name})`, repository.name.toLowerCase()),
        ),
      )
    return row?.id
  }

  /** The task issue `number` of `repository` is linked to, if any. */
  async #linked(repository: Repository, number: number): Promise<LinkedTask | undefined> {
    const [row] = await this.#db
      .select({
        taskId: tasks.id,
        title: tasks.title,
        status: tasks.status,
        repositoryId: taskIssues.repositoryId,
        githubId: taskIssues.githubId,
        seenState: taskIssues.seenState,
        seenStatus: taskIssues.seenStatus,
        synced: sql<boolean>`exists (
          select 1 from project_repository_requests r
          where r.project_id = ${tasks.projectId}
            and r.repository_id = ${taskIssues.repositoryId}
            and r.state = 'approved'
        )`,
      })
      .from(taskIssues)
      .innerJoin(tasks, eq(tasks.id, taskIssues.taskId))
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .where(
        and(
          eq(sql`lower(${repositories.owner})`, repository.owner.toLowerCase()),
          eq(sql`lower(${repositories.name})`, repository.name.toLowerCase()),
          eq(taskIssues.number, number),
        ),
      )
    return row
  }

  /** The issue's state and its Project items, or that it is deleted. */
  async #read(client: GitHubClient, repository: Repository, number: number): Promise<IssueNow> {
    let data: unknown
    try {
      ;({ data } = await client.rest('readIssues', repository, {
        method: 'GET',
        path: ['issues', number],
      }))
    } catch (error) {
      // GitHub answers a deleted issue as gone (410), or as not found (404) within a repository
      // the function reaches; the client reports a repository it cannot reach otherwise.
      if (error instanceof GitHubRequestError && (error.status === 404 || error.status === 410)) {
        return { state: 'deleted' }
      }
      throw error
    }
    const closed = stringField(data, 'state') === 'closed'
    const state = !closed
      ? 'open'
      : stringField(data, 'state_reason') === 'not_planned'
        ? 'not-planned'
        : 'closed'
    const items = await readProjectItems(client, repository, number, this.#field.name)
    return { state, items }
  }

  /**
   * Creates the task's deleted issue again in its repository, with the task's title, and links
   * the new issue to the task in its place, holding the repository's issue-links lock. Its
   * planning is the mirror's, which is told of the task next.
   */
  async #recreate(client: GitHubClient, repository: Repository, linked: LinkedTask): Promise<void> {
    await this.#db.transaction(async (tx) => {
      await lockIssueLinks(tx, linked.repositoryId)
      const { data } = await client.rest('writeIssues', repository, {
        method: 'POST',
        path: ['issues'],
        body: { title: linked.title },
      })
      const number = numberField(data, 'number')
      const githubId = numberField(data, 'id')
      if (number === undefined || githubId === undefined) {
        throw new Error('GitHub answered a created issue without its number or id')
      }
      await tx
        .update(taskIssues)
        .set({ number, githubId, milestoneNumber: null, seenState: 'open', seenStatus: null })
        .where(and(eq(taskIssues.taskId, linked.taskId), eq(taskIssues.githubId, linked.githubId)))
    })
  }

  /** GitHub's ids of the issues GitHub shows as the issue's sub-issues or as blocked by it. */
  async #relatedOnGitHub(
    client: GitHubClient,
    repository: Repository,
    number: number,
  ): Promise<number[]> {
    const lists = await Promise.all(
      [
        ['issues', number, 'sub_issues'],
        ['issues', number, 'dependencies', 'blocking'],
      ].map((path) => client.restPages('readIssues', repository, { path })),
    )
    return lists.flat().flatMap((issue) => {
      const id = numberField(issue, 'id')
      return id === undefined ? [] : [id]
    })
  }

  /**
   * The tasks besides the issue's own whose planning on GitHub the change may have touched: those
   * linked to the issues GitHub shows related to it, and the task's own subtasks and the tasks it
   * blocks, whose parent and blockers the mirror sets from their side.
   */
  async #relatedInTool(taskId: string, githubIds: readonly number[]): Promise<string[]> {
    const linked =
      githubIds.length === 0
        ? []
        : await this.#db
            .select({ id: taskIssues.taskId })
            .from(taskIssues)
            .where(inArray(taskIssues.githubId, [...githubIds]))
    const near = await this.#db
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(taskBlockedBy, eq(taskBlockedBy.taskId, tasks.id))
      .where(or(eq(tasks.parentId, taskId), eq(taskBlockedBy.blockerId, taskId)))
    return [...new Set([...linked, ...near].map((row) => row.id))].filter((id) => id !== taskId)
  }
}
