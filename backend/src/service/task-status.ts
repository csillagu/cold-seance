import { eq } from 'drizzle-orm'
import type { Executor } from '../db/client.ts'
import { TASK_STATUSES, tasks } from '../db/schema.ts'
import type { Actor, AuditLogService, GitHubUser } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { TaskStatus } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { TaskAssignments } from './assignment.ts'
import { lockPlan } from './plan-scheduling.ts'
import { lockRelations } from './task-relations.ts'
import { checkStatusConstraints, mayBeConstrained } from './task-status-constraints.ts'
import { type Task, taskColumns, type TaskRow, toCompleteTask } from './tasks.ts'

/**
 * The statuses the transitions set a task to (SC-003): in progress, on hold and done, from any
 * status but cancelled. A task is cancelled by its cancellation (SC-038), not here, and is never
 * set back to not started.
 */
const TARGETS: ReadonlySet<TaskStatus> = new Set(['in-progress', 'on-hold', 'done'])

/** Answers today's date, `YYYY-MM-DD`: the date an actual start or finish is recorded with. */
export type Today = () => string

/**
 * Today's date in the deployment's time zone: the local time zone of the process, which the `TZ`
 * environment variable sets (UTC in the Docker image unless it is given).
 */
export function localToday(now: Date = new Date()): string {
  const pad = (value: number, width: number) => String(value).padStart(width, '0')
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
}

/**
 * What a status change made on GitHub came to: `set`, or `unchanged` for a task already in that
 * status, or `refused` for a move the task's relations forbid (SC-037), or of a cancelled task,
 * which the GitHub change handler (SC-023) then reverts on GitHub (FR-095).
 */
export type GitHubStatusOutcome = 'set' | 'unchanged' | 'refused'

/** What a move sets besides the status: the task's actual start and finish. */
type ActualDates = Pick<TaskRow, 'actualStart' | 'actualFinish'>

/**
 * The task status transitions of the service layer (DD-039, SC-003): they move a task through its
 * statuses, in progress, on hold, done and back to in progress, and record its actual start and
 * finish, whichever channel the change comes through.
 *
 * - Starting a task, setting it in progress when it has no actual start yet, records today as its
 *   actual start (FR-022). Setting it back to in progress later keeps the start it has.
 * - Finishing it records today as its actual finish (FR-023).
 * - Putting it on hold only marks it: its planned dates, its duration and so its load stay as they
 *   were (DD-007, FR-024).
 * - Moving a finished task to any other status clears its actual finish, since it is not finished
 *   any more, and keeps its actual start.
 *
 * No move between not started, in progress, on hold and done is refused for the statuses alone:
 * GitHub may finish or hold a task whatever its status (FR-092, FR-093, FR-099). The constraint
 * checks (SC-037, `checkStatusConstraints`) refuse the moves a task's relations forbid: finishing a
 * parent while a subtask is open (FR-025), and starting or finishing a task before its blockers
 * have finished (FR-026).
 *
 * Whoever may edit the project's plan may set any of these statuses; a contributor only marks a
 * task they are assigned to as in progress, on hold or finished, and cannot reopen a finished one
 * (FR-107, `ProjectPermissions.requireStatusChange`). Someone with no role in the project is told
 * it is not visible to them (FR-017). Each change is recorded in the audit log, in the
 * transaction that makes it (FR-116).
 */
export class TaskStatusService {
  readonly #db: Executor
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #today: Today

  constructor(
    db: Executor,
    audit: AuditLogService,
    roles: ProjectRoleService,
    today: Today = localToday,
  ) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#today = today
  }

  /**
   * Sets the task's status to `status`, recording its actual start or finish as the move asks,
   * and answers the task as it now is. Setting the status it already has changes nothing.
   *
   * Refused as not found if there is no such task, as not visible to someone with no role in its
   * project, as invalid if `status` is not in progress, on hold or done or the task is cancelled,
   * as forbidden if the caller's role does not allow the change, and as a conflict if the task's
   * relations forbid it (SC-037).
   */
  async setStatus(caller: Caller, taskId: string, status: unknown): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // Visibility is checked before the task is locked, so that someone with no role in its
      // project cannot hold it up; then it is locked, so that what the checks read, its status
      // above all, is what the change starts from. A task never changes project.
      const found = await this.#find(taskId, tx, false)
      await this.#roles.permissions.require(caller, found.projectId, 'read', tx)
      const to = validStatus(status)
      // A move the constraint checks may refuse takes the relations lock before the task's row,
      // in the order every change of a relation takes them, so that the subtasks and blockers it
      // is checked against cannot change under it, nor two such moves wait for each other. The
      // lock is one for the whole tool, so whoever may not make the move at all is refused first,
      // against the task as read so far, and cannot hold it up; the check is made again below,
      // against the task as it is once locked.
      if (mayBeConstrained(to)) {
        await this.#roles.permissions.requireStatusChange(
          caller,
          found.projectId,
          { assignees: found.assignees, from: found.status, to },
          tx,
        )
        await lockRelations(tx)
        // And the plan's lock, in the order the scheduler takes them (SC-004): a change of dates
        // writes the rows of a task's parent and of the tasks it blocks, which the constraint
        // checks lock too, so the two must not each hold a row the other waits for.
        await lockPlan(tx, found.projectId)
      }
      const current = await this.#find(taskId, tx, true)
      if (!TARGETS.has(to) || current.status === 'cancelled') {
        throw invalid(refusal(current.status, to))
      }
      // The assignees are read with the task locked, so that a contributor is checked against
      // who is assigned now (SC-005).
      await this.#roles.permissions.requireStatusChange(
        caller,
        current.projectId,
        { assignees: current.assignees, from: current.status, to },
        tx,
      )
      if (to === current.status) return this.#out(tx, current)
      await checkStatusConstraints(tx, current, to)
      return this.#out(tx, await this.#move(tx, caller, current, to))
    })
  }

  /**
   * Sets the task's status to `status`, as a change made on GitHub by `user` (FR-091 to FR-094):
   * whatever their role in the tool, or none (FR-099). The constraint checks hold as through any
   * other channel (FR-115): a move they refuse, or of a cancelled task, changes nothing and is
   * answered `refused`. Each change is recorded in the audit log under the GitHub login
   * (SRC-251).
   */
  async setStatusFromGitHub(
    user: GitHubUser,
    taskId: string,
    status: 'in-progress' | 'on-hold' | 'done',
  ): Promise<GitHubStatusOutcome> {
    return this.#db.transaction(async (tx) => {
      const found = await this.#find(taskId, tx, false)
      if (mayBeConstrained(status)) {
        await lockRelations(tx)
        await lockPlan(tx, found.projectId)
      }
      const current = await this.#find(taskId, tx, true)
      if (current.status === 'cancelled') return 'refused'
      if (current.status === status) return 'unchanged'
      try {
        await checkStatusConstraints(tx, current, status)
      } catch (error) {
        if (error instanceof ServiceError && error.kind === 'conflict') return 'refused'
        throw error
      }
      await this.#move(tx, user, current, status)
      return 'set'
    })
  }

  /** Moves the locked task to `to`, recording the move in the audit log. */
  async #move(tx: Executor, actor: Actor, current: TaskRow, to: TaskStatus): Promise<TaskRow> {
    const dates = move(current, to, this.#today)
    const [updated] = await tx
      .update(tasks)
      .set({ status: to, ...dates })
      .where(eq(tasks.id, current.id))
      .returning(taskColumns)
    if (!updated) throw new Error('The task whose status was set was not returned')
    const changed = (['actualStart', 'actualFinish'] as const).filter(
      (field) => dates[field] !== current[field],
    )
    await this.#audit.record(tx, actor, {
      action: 'task.status-set',
      subject: { type: 'task', id: current.id },
      projectId: current.projectId,
      details: {
        changes: { status: to, ...pick(dates, changed) },
        previous: { status: current.status, ...pick(current, changed) },
      },
    })
    return updated
  }

  #out(executor: Executor, row: TaskRow): Promise<Task> {
    return toCompleteTask(new TaskAssignments(this.#roles), executor, row)
  }

  async #find(taskId: string, executor: Executor, lock: boolean): Promise<TaskRow> {
    if (!isUuid(taskId)) throw noSuchTask()
    const query = executor.select(taskColumns).from(tasks).where(eq(tasks.id, taskId))
    const [task] = lock ? await query.for('update') : await query
    if (!task) throw noSuchTask()
    return task
  }
}

/** The actual start and finish the task has once it is moved from its status to `to`. */
function move(current: TaskRow, to: TaskStatus, today: Today): ActualDates {
  const dates: ActualDates = {
    actualStart: current.actualStart,
    actualFinish: current.actualFinish,
  }
  if (to === 'in-progress' && dates.actualStart === null) dates.actualStart = today()
  if (to === 'done') dates.actualFinish = today()
  else if (current.status === 'done') dates.actualFinish = null
  return dates
}

/** Why the transitions do not set a task in status `from` to `to`. */
function refusal(from: TaskStatus, to: TaskStatus): string {
  if (to === 'cancelled') return 'A task is cancelled by cancelling it, not by setting its status'
  if (from === 'cancelled') return 'The status of a cancelled task cannot be set'
  return 'A task cannot be set back to not started'
}

function validStatus(value: unknown): TaskStatus {
  const status = TASK_STATUSES.find((known) => known === value)
  if (status === undefined) {
    throw invalid(`A task's status is one of ${TASK_STATUSES.join(', ')}`)
  }
  return status
}

/** The given actual dates, for the audit log. */
function pick(from: ActualDates, keys: readonly (keyof ActualDates)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, from[key]]))
}

function noSuchTask(): ServiceError {
  return new ServiceError('not-found', 'There is no such task')
}

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}
