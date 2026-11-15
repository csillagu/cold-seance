import { and, asc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import {
  accounts,
  repositories,
  taskAssignees,
  taskBlockedBy,
  taskIssues,
  tasks,
} from '../db/schema.ts'
import type { PlanningPart } from '../service/notifications.ts'
import type { PlanningChanges } from '../service/planning-changes.ts'
import type { Repository } from './app-tokens.ts'
import { GitHubRequestError, type GitHubClient } from './client.ts'
import { GitHubIssueCreator } from './issue-creator.ts'
import { arrayField, numberField, objectField, stringField } from './json.ts'
import { GitHubNotPlannedCloser } from './not-planned-closer.ts'
import { NO_REVERT_REPORTS, type RevertReports } from './revert-commenter.ts'

/** A task's linked issue, as the mirror needs it. */
interface LinkedIssue {
  repository: Repository
  number: number
  /** GitHub's own id for the issue, by which sub-issues and blocked-by relations name it. */
  githubId: number
  /**
   * Whether the task's project still pulls issues from the issue's repository. A task the
   * project kept after its approval was withdrawn is not synced with its issue (FR-182).
   */
  synced: boolean
}

/** An issue as GitHub names it in a relation: by its id, number and repository. */
interface GitHubIssueRef {
  githubId: number
  number: number
  repository: Repository
}

export interface PlanningMirrorOptions {
  /**
   * Told of each task whose issue the mirror could not bring into line with it, such as while
   * GitHub cannot be reached. Nothing is retried: the re-check puts it right (DD-051).
   */
  onError?: (error: unknown, taskId: string) => void
  /** Told of each task whose planning edited on GitHub the mirror set back (SC-062). */
  reverts?: RevertReports
}

/**
 * The planning mirror as the GitHub change handler (SC-023) tells it of the tasks whose issues'
 * planning may have been edited on GitHub (FR-097), besides the changes made in the tool.
 */
export interface PlanningRestores extends PlanningChanges {
  restore(taskIds: readonly string[]): void
}

/**
 * The GitHub planning mirror (SC-022): it keeps the planning of each task's linked issue identical
 * to the task, the plan being held in the tool (DD-001, FR-089): the task's assignees, as the
 * issue's assignees, leaving off people with no linked GitHub account (FR-090); a fixed-date
 * milestone's date, as the due date of a GitHub milestone of its own that the issue is in; the
 * task's parent, as the issue's parent issue; and its blockers, as the issue's blocked-by
 * relations. A relation the tool cannot show on GitHub, because the other task has no issue, is
 * left off; one GitHub holds that the tool does not is removed.
 *
 * Each relation is mirrored from one side: the parent from the subtask's issue, the blockers from
 * the blocked task's issue, so that mirroring a task brings everything the task holds into line.
 * The issues of tasks a project kept after its approval for the repository was withdrawn are left
 * alone (FR-182): such a task is not mirrored, and a relation with its issue is neither added nor
 * removed.
 *
 * The service layer tells it of each change (`changed`), after the change is committed, and the
 * GitHub change handler (SC-023) of each task whose issue's planning may have been edited on
 * GitHub (`restore`). It mirrors the tasks one at a time in the background, so that two changes of one task cannot
 * overtake each other. A write that fails is put right by the re-check (DD-051), which calls
 * `mirrorAll`.
 *
 * Each task it is told of is first given its issue by the GitHub issue creator (SC-060), if it is
 * assigned to a repository and has none, so that a new issue is mirrored at once; and once
 * mirrored, a cancelled task's issue is closed as not planned by the not-planned closer (SC-061).
 *
 * What it writes to the issue of a task it was told of only to restore is a revert of an edit
 * made on GitHub (FR-097), which it tells the revert commenter (SC-062) of. A task it was also
 * told of as changed in the tool, before it was mirrored, is not: what it writes then may be the
 * tool's own change.
 */
export class GitHubPlanningMirror implements PlanningRestores {
  readonly #db: Database
  readonly #github: () => GitHubClient
  readonly #onError: (error: unknown, taskId: string) => void
  readonly #creator: GitHubIssueCreator
  readonly #closer: GitHubNotPlannedCloser
  readonly #reverts: RevertReports
  #client: GitHubClient | undefined
  /** The tasks to mirror, each with whether it is only to be restored. */
  readonly #pending = new Map<string, boolean>()
  #running: Promise<void> | undefined

  /** `github` is called when the mirror first calls GitHub, so that the client is built then. */
  constructor(db: Database, github: () => GitHubClient, options: PlanningMirrorOptions = {}) {
    this.#db = db
    this.#github = github
    this.#onError = options.onError ?? (() => {})
    this.#reverts = options.reverts ?? NO_REVERT_REPORTS
    const client = () => (this.#client ??= this.#github())
    this.#creator = new GitHubIssueCreator(db, client)
    this.#closer = new GitHubNotPlannedCloser(db, client)
  }

  changed(taskIds: readonly string[]): void {
    for (const id of taskIds) this.#pending.set(id, false)
    this.#start()
  }

  restore(taskIds: readonly string[]): void {
    for (const id of taskIds) {
      if (!this.#pending.has(id)) this.#pending.set(id, true)
    }
    this.#start()
  }

  /** Resolves once every task the mirror was told of has been mirrored, or has failed. */
  async idle(): Promise<void> {
    while (this.#running !== undefined) await this.#running
  }

  /**
   * Mirrors every task that has a linked issue or is assigned to a repository, creating the issues
   * still missing and closing those of cancelled tasks, and resolves once all are done. The tasks
   * it was told of before are mirrored first, as they were told.
   */
  async mirrorAll(): Promise<void> {
    await this.idle()
    const linked = await this.#db
      .select({ taskId: tasks.id })
      .from(tasks)
      .leftJoin(taskIssues, eq(taskIssues.taskId, tasks.id))
      .where(or(isNotNull(tasks.repositoryId), isNotNull(taskIssues.taskId)))
    this.changed(linked.map((row) => row.taskId))
    await this.idle()
  }

  /**
   * Gives the task its GitHub issue if it has none yet (SC-060), brings the issue into line with
   * the task, and closes it as not planned if the task is cancelled (SC-061). Rejects with what
   * GitHub refused. With `restoring`, what it sets back on an issue it did not just create is
   * told to the revert commenter.
   */
  async syncTask(taskId: string, restoring = false): Promise<void> {
    const created = await this.#creator.create(taskId)
    const parts = await this.mirrorTask(taskId)
    await this.#closer.close(taskId)
    if (restoring && !created && parts.length > 0) {
      await this.#reverts.reverted({ taskId, change: 'planning', parts })
    }
  }

  /**
   * Brings the task's linked issue into line with the task. Nothing is done for a task with no
   * linked issue, or one not synced with it (FR-182). Answers the parts of the issue's planning
   * it changed on GitHub. Rejects with what GitHub refused.
   */
  async mirrorTask(taskId: string): Promise<PlanningPart[]> {
    const [task] = await this.#db
      .select({
        projectId: tasks.projectId,
        title: tasks.title,
        parentId: tasks.parentId,
        milestoneVariant: tasks.milestoneVariant,
        milestoneDate: tasks.milestoneDate,
        milestoneNumber: taskIssues.milestoneNumber,
      })
      .from(tasks)
      .innerJoin(taskIssues, eq(taskIssues.taskId, tasks.id))
      .where(eq(tasks.id, taskId))
    if (!task) return []
    const own = (await this.#issuesOf([taskId])).get(taskId)
    if (own === undefined || !own.synced) return []
    const client = (this.#client ??= this.#github())

    const { data: issue } = await client.rest('readIssues', own.repository, {
      method: 'GET',
      path: ['issues', own.number],
    })
    const patch: Record<string, unknown> = {}
    const parts: PlanningPart[] = []

    const logins = await this.#loginsOf(taskId)
    const current = arrayField(issue, 'assignees').map((user) => stringField(user, 'login'))
    if (!sameLogins(logins, current)) {
      patch['assignees'] = logins
      parts.push('assignees')
    }

    if (task.milestoneVariant === 'fixed-date' && task.milestoneDate !== null) {
      const { number, written } = await this.#milestone(
        client,
        taskId,
        own,
        task.title,
        task.milestoneDate,
        { number: task.milestoneNumber },
      )
      if (numberField(objectField(issue, 'milestone'), 'number') !== number) {
        patch['milestone'] = number
      }
      if (written || patch['milestone'] !== undefined) parts.push('milestone')
    }
    if (Object.keys(patch).length > 0) {
      await client.rest('writeIssues', own.repository, {
        method: 'PATCH',
        path: ['issues', own.number],
        body: patch,
      })
    }

    if (await this.#parent(client, own, task.parentId)) parts.push('parent')
    if (await this.#blockers(client, taskId, own)) parts.push('blocked-by')
    return parts
  }

  #start(): void {
    if (this.#running !== undefined) return
    this.#running = this.#drain().finally(() => {
      this.#running = undefined
      if (this.#pending.size > 0) this.#start()
    })
  }

  async #drain(): Promise<void> {
    for (const [taskId, restoring] of this.#pending) {
      this.#pending.delete(taskId)
      try {
        await this.syncTask(taskId, restoring)
      } catch (error) {
        this.#onError(error, taskId)
      }
    }
  }

  /**
   * The GitHub milestone that holds the fixed-date milestone's date, made if the task has none
   * yet or it is gone from GitHub, with its due date set to the task's: its number, and whether
   * the milestone was written.
   */
  async #milestone(
    client: GitHubClient,
    taskId: string,
    own: LinkedIssue,
    title: string,
    date: string,
    stored: { number: number | null },
  ): Promise<{ number: number; written: boolean }> {
    // Noon UTC is the same date wherever GitHub places the time of a due date.
    const dueOn = `${date}T12:00:00Z`
    if (stored.number !== null) {
      const existing = await optional(
        client.rest('readIssues', own.repository, {
          method: 'GET',
          path: ['milestones', stored.number],
        }),
      )
      if (existing !== undefined) {
        if (dueDate(existing.data) !== date) {
          await client.rest('writeIssues', own.repository, {
            method: 'PATCH',
            path: ['milestones', stored.number],
            body: { due_on: dueOn },
          })
          return { number: stored.number, written: true }
        }
        return { number: stored.number, written: false }
      }
    }
    const { data } = await client.rest('writeIssues', own.repository, {
      method: 'POST',
      path: ['milestones'],
      // GitHub milestone titles are unique in a repository; the issue number makes this one so.
      body: { title: `${title} (#${own.number})`, due_on: dueOn },
    })
    const number = numberField(data, 'number')
    if (number === undefined) throw new Error('GitHub answered a milestone without its number')
    await this.#db
      .update(taskIssues)
      .set({ milestoneNumber: number })
      .where(eq(taskIssues.taskId, taskId))
    return { number, written: true }
  }

  /** Makes the issue the sub-issue of the parent task's issue, or of none: whether it wrote. */
  async #parent(client: GitHubClient, own: LinkedIssue, parentId: string | null): Promise<boolean> {
    const wanted = parentId === null ? undefined : (await this.#issuesOf([parentId])).get(parentId)
    const answer = await optional(
      client.rest('readIssues', own.repository, {
        method: 'GET',
        path: ['issues', own.number, 'parent'],
      }),
    )
    const current = answer === undefined ? undefined : issueRef(answer.data)
    if (current?.githubId === wanted?.githubId) return false
    if (current !== undefined && (await this.#kept(current.githubId))) return false
    if (wanted !== undefined) {
      if (!wanted.synced) return false
      await client.rest('writeIssues', wanted.repository, {
        method: 'POST',
        path: ['issues', wanted.number, 'sub_issues'],
        body: { sub_issue_id: own.githubId, replace_parent: true },
      })
      return true
    }
    if (current === undefined) return false
    await client.rest('writeIssues', current.repository, {
      method: 'DELETE',
      path: ['issues', current.number, 'sub_issue'],
      body: { sub_issue_id: own.githubId },
    })
    return true
  }

  /** Makes the issue blocked by exactly the issues of the task's blockers: whether it wrote. */
  async #blockers(client: GitHubClient, taskId: string, own: LinkedIssue): Promise<boolean> {
    const blockerIds = await this.#db
      .select({ blockerId: taskBlockedBy.blockerId })
      .from(taskBlockedBy)
      .where(eq(taskBlockedBy.taskId, taskId))
    const wanted = [...(await this.#issuesOf(blockerIds.map((row) => row.blockerId))).values()]
    const current = (
      await client.restPages('readIssues', own.repository, {
        path: ['issues', own.number, 'dependencies', 'blocked_by'],
      })
    ).map(issueRef)
    const currentIds = new Set(current.map((issue) => issue?.githubId))
    const wantedIds = new Set(wanted.map((issue) => issue.githubId))
    let written = false
    for (const blocker of wanted) {
      if (currentIds.has(blocker.githubId) || !blocker.synced) continue
      written = true
      await client.rest('writeIssues', own.repository, {
        method: 'POST',
        path: ['issues', own.number, 'dependencies', 'blocked_by'],
        body: { issue_id: blocker.githubId },
      })
    }
    for (const blocker of current) {
      if (blocker === undefined || wantedIds.has(blocker.githubId)) continue
      if (await this.#kept(blocker.githubId)) continue
      written = true
      await client.rest('writeIssues', own.repository, {
        method: 'DELETE',
        path: ['issues', own.number, 'dependencies', 'blocked_by', blocker.githubId],
      })
    }
    return written
  }

  /** The GitHub accounts of the task's assignees, in the task's order; people with none left off. */
  async #loginsOf(taskId: string): Promise<string[]> {
    const rows = await this.#db
      .select({ login: accounts.githubLogin })
      .from(taskAssignees)
      .innerJoin(accounts, eq(accounts.id, taskAssignees.accountId))
      .where(and(eq(taskAssignees.taskId, taskId), isNotNull(accounts.githubLogin)))
      .orderBy(asc(taskAssignees.position))
    return rows.flatMap((row) => (row.login === null ? [] : [row.login]))
  }

  /** The linked issues of those of the tasks that have one, by task id. */
  async #issuesOf(taskIds: readonly string[]): Promise<Map<string, LinkedIssue>> {
    if (taskIds.length === 0) return new Map()
    const rows = await this.#db
      .select({
        taskId: taskIssues.taskId,
        owner: repositories.owner,
        name: repositories.name,
        number: taskIssues.number,
        githubId: taskIssues.githubId,
        synced: syncedColumn,
      })
      .from(taskIssues)
      .innerJoin(tasks, eq(tasks.id, taskIssues.taskId))
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .where(inArray(taskIssues.taskId, [...taskIds]))
    return new Map(
      rows.map((row) => [
        row.taskId,
        {
          repository: { owner: row.owner, name: row.name },
          number: row.number,
          githubId: row.githubId,
          synced: row.synced,
        },
      ]),
    )
  }

  /** Whether the GitHub issue is the linked issue of a task not synced with it (FR-182). */
  async #kept(githubId: number): Promise<boolean> {
    const [row] = await this.#db
      .select({ synced: syncedColumn })
      .from(taskIssues)
      .innerJoin(tasks, eq(tasks.id, taskIssues.taskId))
      .where(eq(taskIssues.githubId, githubId))
    return row !== undefined && !row.synced
  }
}

/**
 * Whether the task is synced with its issue: its project pulls issues from the issue's repository
 * now (FR-142, FR-182), and the issue is not one deleted on GitHub whose deletion finished the task
 * (FR-136, SC-023), which there is nothing left of to mirror to.
 */
const syncedColumn = sql<boolean>`${taskIssues.seenState} <> 'deleted' and exists (
  select 1 from project_repository_requests r
  where r.project_id = ${tasks.projectId}
    and r.repository_id = ${taskIssues.repositoryId}
    and r.state = 'approved'
)`

/** What the call answered, or `undefined` if GitHub answered that it does not exist (404). */
async function optional<T>(call: Promise<T>): Promise<T | undefined> {
  try {
    return await call
  } catch (error) {
    if (error instanceof GitHubRequestError && error.status === 404) return undefined
    throw error
  }
}

/** Whether two lists of GitHub accounts name the same accounts; GitHub names ignore case. */
function sameLogins(a: readonly (string | undefined)[], b: readonly (string | undefined)[]) {
  const set = (list: readonly (string | undefined)[]) =>
    new Set(list.map((login) => login?.toLowerCase()))
  const x = set(a)
  const y = set(b)
  return x.size === y.size && [...x].every((login) => y.has(login))
}

/** The date part of a GitHub milestone's due date, in UTC, or `undefined` if it has none. */
function dueDate(milestone: unknown): string | undefined {
  const due = stringField(milestone, 'due_on')
  return due === undefined ? undefined : new Date(due).toISOString().slice(0, 10)
}

/** An issue as GitHub answers it, by its id, number and repository (from `repository_url`). */
function issueRef(json: unknown): GitHubIssueRef | undefined {
  const githubId = numberField(json, 'id')
  const number = numberField(json, 'number')
  const url = stringField(json, 'repository_url')
  const match = url === undefined ? null : /\/repos\/([^/]+)\/([^/]+)\/?$/.exec(url)
  if (githubId === undefined || number === undefined || !match) return undefined
  const [, owner = '', name = ''] = match
  return {
    githubId,
    number,
    repository: { owner: decodeURIComponent(owner), name: decodeURIComponent(name) },
  }
}
