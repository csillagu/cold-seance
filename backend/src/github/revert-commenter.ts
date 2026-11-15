import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { repositories, taskIssues, tasks } from '../db/schema.ts'
import {
  notifyGitHubRevert,
  type PlanningPart,
  type RevertedChange,
} from '../service/notifications.ts'
import type { TaskStatus } from '../service/permissions.ts'
import type { GitHubClient } from './client.ts'

/** A change made on GitHub to a task's issue that the tool reverted. */
export interface Revert {
  taskId: string
  change: RevertedChange
  /** For `planning`, the parts of the issue's planning set back. */
  parts?: readonly PlanningPart[]
  /** For `delete`, the number of the deleted issue the task's issue now stands in place of. */
  replaced?: number
}

/** Where the change handler (SC-023) and the planning mirror (SC-022) tell of each revert. */
export interface RevertReports {
  /** Resolves once the revert is reported; never rejects. */
  reverted(revert: Revert): Promise<void>
}

/** Tells nobody: the change handler and the planning mirror without a revert commenter. */
export const NO_REVERT_REPORTS: RevertReports = { reverted: () => Promise.resolve() }

export interface RevertCommenterOptions {
  /**
   * Told of each revert the commenter could not comment on, or notify of, such as while GitHub
   * cannot be reached. Nothing is retried.
   */
  onError?: (error: unknown, revert: Revert) => void
}

/** A task's linked issue and what the explanation needs of the task. */
interface Reverted {
  projectId: string
  status: TaskStatus
  repository: { id: string; owner: string; name: string }
  number: number
}

/** A related task, as the explanation names it: by its issue, if it has one GitHub shows. */
interface Related {
  owner: string | null
  name: string | null
  number: number | null
}

const PARTS: Record<PlanningPart, string> = {
  assignees: 'assignees',
  milestone: 'milestone',
  parent: 'parent issue',
  'blocked-by': 'blocked-by relations',
}

/**
 * The GitHub revert commenter (SC-062): for every change the tool reverts on GitHub (DD-032,
 * FR-097), it leaves a short comment on the issue explaining why (FR-098), and has the people
 * subscribed to the issue or its project notified of it (FR-086, SC-012). The GitHub change
 * handler (SC-023) and the planning mirror (SC-022) tell it of each revert once it is made.
 *
 * The comment names the task's unfinished blockers and open subtasks by their issues, which
 * GitHub shows as the issue's blocked-by relations and sub-issues already; one with no issue on
 * GitHub, or whose issue the tool no longer syncs, is only counted.
 */
export class GitHubRevertCommenter implements RevertReports {
  readonly #db: Database
  readonly #github: () => GitHubClient
  readonly #onError: (error: unknown, revert: Revert) => void

  /** `github` is called when the commenter first calls GitHub. */
  constructor(db: Database, github: () => GitHubClient, options: RevertCommenterOptions = {}) {
    this.#db = db
    this.#github = github
    this.#onError = options.onError ?? (() => {})
  }

  async reverted(revert: Revert): Promise<void> {
    let task: Reverted | undefined
    try {
      task = await this.#task(revert.taskId)
      if (task === undefined) return
      await this.#github().rest('writeIssues', task.repository, {
        method: 'POST',
        path: ['issues', task.number, 'comments'],
        body: { body: await this.#explain(revert, task) },
      })
    } catch (error) {
      this.#onError(error, revert)
    }
    if (task === undefined) return
    try {
      await notifyGitHubRevert(this.#db, {
        task: { id: revert.taskId, projectId: task.projectId },
        repository: task.repository,
        number: task.number,
        change: revert.change,
        ...(revert.parts === undefined ? {} : { parts: revert.parts }),
      })
    } catch (error) {
      this.#onError(error, revert)
    }
  }

  /** The comment: what was reverted, and why. */
  async #explain(revert: Revert, task: Reverted): Promise<string> {
    const here = { owner: task.repository.owner, name: task.repository.name }
    const blocking = async () => {
      const blockers = await this.#unfinishedBlockers(revert.taskId)
      if (blockers.length === 0) return []
      return [`it is blocked by ${list(blockers, here)}, ${which(blockers)} not finished`]
    }
    const reasons = async (finishing: boolean): Promise<string[]> => {
      if (task.status === 'cancelled') return ['it is cancelled in the tool']
      const found = await blocking()
      if (finishing) {
        const open = await this.#openSubtasks(revert.taskId)
        if (open.length > 0) {
          found.push(
            `it has ${open.length === 1 ? 'a subtask' : 'subtasks'} still open: ${list(open, here)}`,
          )
        }
      }
      return found
    }
    const because = (found: string[]) =>
      found.length === 0 ? ', as the change breaks a rule of the plan.' : `: ${found.join('; ')}.`

    switch (revert.change) {
      case 'close':
        return `This issue was reopened, as its task cannot be finished yet${because(await reasons(true))}`
      case 'delete': {
        const replaced =
          revert.replaced === undefined
            ? ' after its deletion'
            : ` in place of #${revert.replaced}, which was deleted`
        return (
          `This issue was created again${replaced}, as its task cannot be ` +
          `finished yet${because(await reasons(true))}`
        )
      }
      case 'not-planned': {
        const why =
          task.status === 'done'
            ? 'it is finished, and a finished task cannot be cancelled'
            : 'it is a milestone that a task of another project is blocked by'
        return `This issue was reopened, as its task cannot be cancelled: ${why}.`
      }
      case 'reopen':
        return `This issue was closed again, as its task cannot be set back in progress${because(await reasons(false))}`
      case 'start':
        return `This issue's move to the started status was undone, as its task cannot be started yet${because(await reasons(false))}`
      case 'planning':
        break
    }
    const parts = (revert.parts ?? []).map((part) => PARTS[part])
    const what = parts.length === 0 ? 'planning' : words(parts)
    const only = revert.parts?.length === 1 ? revert.parts[0] : undefined
    const single = parts.length === 0 || only === 'milestone' || only === 'parent'
    return (
      `This issue's ${what} ${single ? 'was' : 'were'} set back to match its ` +
      'task: the plan is kept in the tool, and is changed there.'
    )
  }

  async #task(taskId: string): Promise<Reverted | undefined> {
    const [row] = await this.#db
      .select({
        projectId: tasks.projectId,
        status: tasks.status,
        repositoryId: repositories.id,
        owner: repositories.owner,
        name: repositories.name,
        number: taskIssues.number,
      })
      .from(taskIssues)
      .innerJoin(tasks, eq(tasks.id, taskIssues.taskId))
      .innerJoin(repositories, eq(repositories.id, taskIssues.repositoryId))
      .where(eq(taskIssues.taskId, taskId))
    if (!row) return undefined
    return {
      projectId: row.projectId,
      status: row.status,
      repository: { id: row.repositoryId, owner: row.owner, name: row.name },
      number: row.number,
    }
  }

  /** The task's blockers that have not finished (FR-026), by their synced issues. */
  async #unfinishedBlockers(taskId: string): Promise<Related[]> {
    const result = await this.#db.execute<Related & Record<string, unknown>>(sql`
      select r.owner, r.name, i.number
      from task_blocked_by b
      join tasks t on t.id = b.blocker_id
      ${issueOf}
      where b.task_id = ${taskId}::uuid and t.status <> 'done'
      order by r.owner, r.name, i.number
    `)
    return result.rows
  }

  /** The task's subtasks, at any depth, that are open (FR-025), by their synced issues. */
  async #openSubtasks(taskId: string): Promise<Related[]> {
    const result = await this.#db.execute<Related & Record<string, unknown>>(sql`
      with recursive below(id) as (
        select id from tasks where parent_id = ${taskId}::uuid
        union
        select tasks.id from tasks join below on tasks.parent_id = below.id
      )
      select r.owner, r.name, i.number
      from below
      join tasks t on t.id = below.id
      ${issueOf}
      where t.status not in ('done', 'cancelled')
      order by r.owner, r.name, i.number
    `)
    return result.rows
  }
}

/**
 * Joins the issue of task `t`, if it has one the tool syncs: its project pulls issues from the
 * issue's repository (FR-182), and it is not deleted.
 */
const issueOf = sql`
  left join task_issues i on i.task_id = t.id and i.seen_state <> 'deleted' and exists (
    select 1 from project_repository_requests q
    where q.project_id = t.project_id and q.repository_id = i.repository_id and q.state = 'approved'
  )
  left join repositories r on r.id = i.repository_id
`

/** The related tasks in words: their issues, `#1` in the same repository, and those without. */
function list(related: readonly Related[], here: { owner: string; name: string }): string {
  const named = related.flatMap((task) => {
    if (task.number === null || task.owner === null || task.name === null) return []
    const same =
      task.owner.toLowerCase() === here.owner.toLowerCase() &&
      task.name.toLowerCase() === here.name.toLowerCase()
    return [same ? `#${task.number}` : `${task.owner}/${task.name}#${task.number}`]
  })
  const unnamed = related.length - named.length
  if (unnamed > 0) {
    named.push(unnamed === 1 ? 'a task with no issue here' : `${unnamed} tasks with no issue here`)
  }
  return words(named)
}

/** `which is` for one task, `which are` for more. */
function which(related: readonly Related[]): string {
  return related.length === 1 ? 'which is' : 'which are'
}

/** The items joined in words: `a, b and c`. */
function words(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`
}
