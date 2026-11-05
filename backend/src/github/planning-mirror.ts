import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import {
  accounts,
  repositories,
  taskAssignees,
  taskBlockedBy,
  taskIssues,
  tasks,
} from '../db/schema.ts'
import type { PlanningChanges } from '../service/planning-changes.ts'
import type { Repository } from './app-tokens.ts'
import { GitHubRequestError, type GitHubClient } from './client.ts'

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
 * The service layer tells it of each change (`changed`), after the change is committed; it
 * mirrors the tasks one at a time in the background, so that two changes of one task cannot
 * overtake each other. A write that fails is put right by the re-check (DD-051), which calls
 * `mirrorAll`.
 */
export class GitHubPlanningMirror implements PlanningChanges {
  readonly #db: Database
  readonly #github: () => GitHubClient
  readonly #onError: (error: unknown, taskId: string) => void
  #client: GitHubClient | undefined
  readonly #pending = new Set<string>()
  #running: Promise<void> | undefined

  /** `github` is called when the mirror first calls GitHub, so that the client is built then. */
  constructor(db: Database, github: () => GitHubClient, options: PlanningMirrorOptions = {}) {
    this.#db = db
    this.#github = github
    this.#onError = options.onError ?? (() => {})
  }

  changed(taskIds: readonly string[]): void {
    for (const id of taskIds) this.#pending.add(id)
    this.#start()
  }

  /** Resolves once every task the mirror was told of has been mirrored, or has failed. */
  async idle(): Promise<void> {
    while (this.#running !== undefined) await this.#running
  }

  /** Mirrors every task that has a linked issue, and resolves once all are done. */
  async mirrorAll(): Promise<void> {
    const linked = await this.#db.select({ taskId: taskIssues.taskId }).from(taskIssues)
    this.changed(linked.map((row) => row.taskId))
    await this.idle()
  }

  /**
   * Brings the task's linked issue into line with the task. Nothing is done for a task with no
   * linked issue, or one not synced with it (FR-182). Rejects with what GitHub refused.
   */
  async mirrorTask(taskId: string): Promise<void> {
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
    if (!task) return
    const own = (await this.#issuesOf([taskId])).get(taskId)
    if (own === undefined || !own.synced) return
    this.#client ??= this.#github()
    const client = this.#client

    const { data: issue } = await client.rest('readIssues', own.repository, {
      method: 'GET',
      path: ['issues', own.number],
    })
    const patch: Record<string, unknown> = {}

    const logins = await this.#loginsOf(taskId)
    const current = arrayField(issue, 'assignees').map((user) => stringField(user, 'login'))
    if (!sameLogins(logins, current)) patch['assignees'] = logins

    if (task.milestoneVariant === 'fixed-date' && task.milestoneDate !== null) {
      const number = await this.#milestone(client, taskId, own, task.title, task.milestoneDate, {
        number: task.milestoneNumber,
      })
      if (numberField(objectField(issue, 'milestone'), 'number') !== number) {
        patch['milestone'] = number
      }
    }
    if (Object.keys(patch).length > 0) {
      await client.rest('writeIssues', own.repository, {
        method: 'PATCH',
        path: ['issues', own.number],
        body: patch,
      })
    }

    await this.#parent(client, own, task.parentId)
    await this.#blockers(client, taskId, own)
  }

  #start(): void {
    if (this.#running !== undefined) return
    this.#running = this.#drain().finally(() => {
      this.#running = undefined
      if (this.#pending.size > 0) this.#start()
    })
  }

  async #drain(): Promise<void> {
    for (const taskId of this.#pending) {
      this.#pending.delete(taskId)
      try {
        await this.mirrorTask(taskId)
      } catch (error) {
        this.#onError(error, taskId)
      }
    }
  }

  /**
   * The GitHub milestone that holds the fixed-date milestone's date, made if the task has none
   * yet or it is gone from GitHub, with its due date set to the task's: its number.
   */
  async #milestone(
    client: GitHubClient,
    taskId: string,
    own: LinkedIssue,
    title: string,
    date: string,
    stored: { number: number | null },
  ): Promise<number> {
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
        }
        return stored.number
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
    return number
  }

  /** Makes the issue the sub-issue of the parent task's issue, or of none. */
  async #parent(client: GitHubClient, own: LinkedIssue, parentId: string | null): Promise<void> {
    const wanted = parentId === null ? undefined : (await this.#issuesOf([parentId])).get(parentId)
    const answer = await optional(
      client.rest('readIssues', own.repository, {
        method: 'GET',
        path: ['issues', own.number, 'parent'],
      }),
    )
    const current = answer === undefined ? undefined : issueRef(answer.data)
    if (current?.githubId === wanted?.githubId) return
    if (current !== undefined && (await this.#kept(current.githubId))) return
    if (wanted !== undefined) {
      if (!wanted.synced) return
      await client.rest('writeIssues', wanted.repository, {
        method: 'POST',
        path: ['issues', wanted.number, 'sub_issues'],
        body: { sub_issue_id: own.githubId, replace_parent: true },
      })
    } else if (current !== undefined) {
      await client.rest('writeIssues', current.repository, {
        method: 'DELETE',
        path: ['issues', current.number, 'sub_issue'],
        body: { sub_issue_id: own.githubId },
      })
    }
  }

  /** Makes the issue blocked by exactly the issues of the task's blockers. */
  async #blockers(client: GitHubClient, taskId: string, own: LinkedIssue): Promise<void> {
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
    for (const blocker of wanted) {
      if (currentIds.has(blocker.githubId) || !blocker.synced) continue
      await client.rest('writeIssues', own.repository, {
        method: 'POST',
        path: ['issues', own.number, 'dependencies', 'blocked_by'],
        body: { issue_id: blocker.githubId },
      })
    }
    for (const blocker of current) {
      if (blocker === undefined || wantedIds.has(blocker.githubId)) continue
      if (await this.#kept(blocker.githubId)) continue
      await client.rest('writeIssues', own.repository, {
        method: 'DELETE',
        path: ['issues', own.number, 'dependencies', 'blocked_by', blocker.githubId],
      })
    }
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

/** Whether the task's project pulls issues from its issue's repository now (FR-142, FR-182). */
const syncedColumn = sql<boolean>`exists (
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

function objectField(json: unknown, name: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined
  const value: unknown = Reflect.get(json, name)
  return value
}

function stringField(json: unknown, name: string): string | undefined {
  const value = objectField(json, name)
  return typeof value === 'string' ? value : undefined
}

function numberField(json: unknown, name: string): number | undefined {
  const value = objectField(json, name)
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function arrayField(json: unknown, name: string): unknown[] {
  const value = objectField(json, name)
  return Array.isArray(value) ? (value as unknown[]) : []
}
