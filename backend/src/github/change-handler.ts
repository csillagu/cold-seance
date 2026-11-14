import { and, eq, inArray, or, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { repositories, taskBlockedBy, taskIssues, tasks } from '../db/schema.ts'
import { ServiceError } from '../service/errors.ts'
import type { PlanningChanges } from '../service/planning-changes.ts'
import { checkStatusConstraints } from '../service/task-status-constraints.ts'
import type { Repository } from './app-tokens.ts'
import { GitHubRequestError, type GitHubClient } from './client.ts'
import { numberField, stringField } from './json.ts'

/** A task's linked issue, as the handler finds it from the issue GitHub names. */
interface LinkedTask {
  taskId: string
  title: string
  status: string
  actualStart: string | null
  repositoryId: string
  githubId: number
  /** Whether the task's project still pulls issues from the issue's repository (FR-182). */
  synced: boolean
}

/** The issue as GitHub answers it now: open, closed with its reason, or deleted. */
type IssueState =
  { kind: 'open' } | { kind: 'closed'; reason: string | undefined } | { kind: 'deleted' }

/**
 * The GitHub change handler (SC-023): it handles each change to a linked issue that reaches the
 * tool from GitHub, by a webhook (SC-105) or found by the re-check (SC-024). It is told which issue
 * changed and reads the issue as it is now, so a change it is told of twice, or late, is handled
 * the same.
 *
 * What it does so far:
 *
 * - **Reverts the status changes that break a constraint** (FR-095, DD-032): a task's issue closed
 *   on GitHub while the task may not be finished, because one of its subtasks is open (FR-025) or
 *   a task blocking it has not finished (FR-026), is reopened; such an issue deleted on GitHub
 *   (FR-136) is created again in its repository, with the task's title, and linked to the task in
 *   its place. The tool's state is left as it was.
 * - **Undoes planning edits made on GitHub** (FR-097): the planning of the issue's task, of the
 *   tasks whose issues GitHub now shows as its sub-issues or as blocked by it, and of the task's
 *   own subtasks and the tasks it blocks, is mirrored to GitHub again by the planning mirror
 *   (SC-022), which restores the tool's assignees, parent and blocked-by relations there.
 *
 * The issues of tasks a project kept after its approval for the repository was withdrawn are
 * ignored (FR-182), and so is an issue linked to no task.
 *
 * Pending, waiting for the owner (issue #122): accepting a status change made on GitHub (start and
 * hold from the Projects status field, finish, reopen, cancel, a delete taken as a finish:
 * FR-091 to FR-094, FR-096, FR-099, FR-136) and turning a new issue into an unscheduled task
 * (FR-100, FR-156, FR-157). They are changes in the tool, which the audit log records with who
 * made them (FR-116), and how a GitHub user with no account in the tool is recorded there is not
 * stated; start and hold also wait for which status field and values mean them (#116).
 *
 * The handler deals with one change at a time, so that two changes of one issue cannot both
 * create it again.
 */
export class GitHubChangeHandler {
  readonly #db: Database
  readonly #github: () => GitHubClient
  readonly #mirror: PlanningChanges
  #queue: Promise<void> = Promise.resolve()

  /**
   * `github` is called when the handler first calls GitHub; `mirror` is the GitHub planning mirror
   * (SC-022), told of each task whose planning is to be restored on GitHub.
   */
  constructor(db: Database, github: () => GitHubClient, mirror: PlanningChanges) {
    this.#db = db
    this.#github = github
    this.#mirror = mirror
  }

  /**
   * Handles a change to issue `number` of `repository` on GitHub. Resolves once the issue's status
   * is dealt with and the planning mirror is told of the tasks to mirror again; rejects with what
   * GitHub refused, for the re-check to put right (DD-051).
   */
  issueChanged(repository: Repository, number: number): Promise<void> {
    const run = this.#queue.then(() => this.#handle(repository, number))
    this.#queue = run.catch(() => {})
    return run
  }

  async #handle(repository: Repository, number: number): Promise<void> {
    const linked = await this.#linked(repository, number)
    if (linked === undefined || !linked.synced) return
    const client = this.#github()
    const state = await this.#stateOf(client, repository, number)

    // A close as not planned cancels the task (FR-096), which no constraint of FR-025 or FR-026
    // forbids; any other close, or a delete (FR-136), finishes it.
    const finishes =
      state.kind === 'deleted' || (state.kind === 'closed' && state.reason !== 'not_planned')
    let recreated = false
    if (finishes && isOpen(linked.status) && !(await this.#mayFinish(linked))) {
      if (state.kind === 'deleted') {
        await this.#recreate(client, repository, linked)
        recreated = true
      } else {
        await client.rest('writeIssues', repository, {
          method: 'PATCH',
          path: ['issues', number],
          body: { state: 'open' },
        })
      }
    }

    const exists = state.kind !== 'deleted' || recreated
    const onGitHub =
      state.kind === 'deleted' ? [] : await this.#relatedOnGitHub(client, repository, number)
    const related = await this.#relatedInTool(linked.taskId, onGitHub)
    this.#mirror.changed(exists ? [linked.taskId, ...related] : related)
  }

  /** The task issue `number` of `repository` is linked to, if any. */
  async #linked(repository: Repository, number: number): Promise<LinkedTask | undefined> {
    const [row] = await this.#db
      .select({
        taskId: tasks.id,
        title: tasks.title,
        status: tasks.status,
        actualStart: tasks.actualStart,
        repositoryId: taskIssues.repositoryId,
        githubId: taskIssues.githubId,
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

  async #stateOf(
    client: GitHubClient,
    repository: Repository,
    number: number,
  ): Promise<IssueState> {
    try {
      const { data } = await client.rest('readIssues', repository, {
        method: 'GET',
        path: ['issues', number],
      })
      return stringField(data, 'state') === 'closed'
        ? { kind: 'closed', reason: stringField(data, 'state_reason') }
        : { kind: 'open' }
    } catch (error) {
      // GitHub answers a deleted issue as gone (410), or as not found (404) within a repository
      // the function reaches; the client reports a repository it cannot reach otherwise.
      if (error instanceof GitHubRequestError && (error.status === 404 || error.status === 410)) {
        return { kind: 'deleted' }
      }
      throw error
    }
  }

  /** Whether the task's relations allow it to be finished now (SC-037). */
  async #mayFinish(linked: LinkedTask): Promise<boolean> {
    return this.#db.transaction(async (tx) => {
      try {
        await checkStatusConstraints(
          tx,
          { id: linked.taskId, actualStart: linked.actualStart },
          'done',
        )
        return true
      } catch (error) {
        if (error instanceof ServiceError && error.kind === 'conflict') return false
        throw error
      }
    })
  }

  /**
   * Creates the task's deleted issue again in its repository, with the task's title, and links
   * the new issue to the task in its place. Its planning is the mirror's, which is told of the task
   * next.
   */
  async #recreate(client: GitHubClient, repository: Repository, linked: LinkedTask): Promise<void> {
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
    await this.#db
      .update(taskIssues)
      .set({ number, githubId, milestoneNumber: null })
      .where(and(eq(taskIssues.taskId, linked.taskId), eq(taskIssues.githubId, linked.githubId)))
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
    const subtasks = await this.#db
      .select({ id: tasks.id })
      .from(tasks)
      .leftJoin(taskBlockedBy, eq(taskBlockedBy.taskId, tasks.id))
      .where(or(eq(tasks.parentId, taskId), eq(taskBlockedBy.blockerId, taskId)))
    return [...new Set([...linked, ...subtasks].map((row) => row.id))].filter((id) => id !== taskId)
  }
}

/** Whether a task in this status is still to be finished: neither done nor cancelled. */
function isOpen(status: string): boolean {
  return status !== 'done' && status !== 'cancelled'
}
