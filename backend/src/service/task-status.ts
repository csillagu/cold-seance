import { eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { TASK_STATUSES, tasks } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { TaskStatus } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { type Task, taskColumns, type TaskRow, toTask } from './tasks.ts'

/**
 * The moves of a task's status that the status transitions make (SC-003): a task not started is
 * started; one in progress is put on hold or finished; one on hold, or one finished, is set back
 * to in progress. No other move is made here: a task is cancelled by its cancellation (SC-038).
 */
const MOVES: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  'not-started': new Set(['in-progress']),
  'in-progress': new Set(['on-hold', 'done']),
  'on-hold': new Set(['in-progress']),
  done: new Set(['in-progress']),
  cancelled: new Set(),
}

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

/** What a move sets besides the status: the task's actual start and finish. */
type ActualDates = Pick<TaskRow, 'actualStart' | 'actualFinish'>

/**
 * The task status transitions of the service layer (DD-039, SC-003): they move a task through its
 * statuses, in progress, on hold, done and back to in progress, and record its actual start and
 * finish, whichever channel the change comes through.
 *
 * - Starting a task records today as its actual start (FR-022).
 * - Finishing it records today as its actual finish (FR-023).
 * - Putting it on hold only marks it: its planned dates, its duration and so its load stay as they
 *   were (DD-007, FR-024). Setting it back to in progress from hold keeps its actual start.
 * - Setting a finished task back to in progress clears its actual finish, since it is not finished
 *   any more, and keeps its actual start.
 *
 * Whoever may edit the project's plan may set any of these statuses; a contributor only marks a
 * task they are assigned to as in progress, on hold or finished, and cannot reopen a finished one
 * (FR-107, `ProjectPermissions.requireStatusChange`). Someone with no role in the project is told
 * it is not visible to them (FR-017). Each change is recorded in the audit log, in the
 * transaction that makes it (FR-116).
 */
export class TaskStatusService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #today: Today

  constructor(
    db: Database,
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
   * project, as invalid if `status` is not a status, and as forbidden if the caller's role does
   * not allow the change; refused as invalid too if the move is not one the transitions make.
   */
  async setStatus(caller: Caller, taskId: string, status: unknown): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // Visibility is checked before the task is locked, so that someone with no role in its
      // project cannot hold it up; then it is locked, so that what the checks read, its status
      // above all, is what the change starts from. A task never changes project.
      const found = await this.#find(taskId, tx, false)
      await this.#roles.permissions.require(caller, found.projectId, 'read', tx)
      const current = await this.#find(taskId, tx, true)
      const to = validStatus(status)
      // The assignees come with the eligibility and assignment module (SC-005); until then a task
      // has none, so a contributor can set the status of no task.
      await this.#roles.permissions.requireStatusChange(
        caller,
        current.projectId,
        { assignees: [], from: current.status, to },
        tx,
      )
      if (to === current.status) return toTask(current)
      const dates = move(current, to, this.#today)
      const [updated] = await tx
        .update(tasks)
        .set({ status: to, ...dates })
        .where(eq(tasks.id, taskId))
        .returning(taskColumns)
      if (!updated) throw new Error('The task whose status was set was not returned')
      const changed = (['actualStart', 'actualFinish'] as const).filter(
        (field) => dates[field] !== current[field],
      )
      await this.#audit.record(tx, caller, {
        action: 'task.status-set',
        subject: { type: 'task', id: taskId },
        projectId: current.projectId,
        details: {
          changes: { status: to, ...pick(dates, changed) },
          previous: { status: current.status, ...pick(current, changed) },
        },
      })
      return toTask(updated)
    })
  }

  async #find(taskId: string, executor: Executor, lock: boolean): Promise<TaskRow> {
    if (!isUuid(taskId)) throw noSuchTask()
    const query = executor.select(taskColumns).from(tasks).where(eq(tasks.id, taskId))
    const [task] = lock ? await query.for('update') : await query
    if (!task) throw noSuchTask()
    return task
  }
}

/**
 * The actual start and finish the task has once it is moved to `to`; refused as invalid if the
 * transitions do not make that move.
 */
function move(current: TaskRow, to: TaskStatus, today: Today): ActualDates {
  const from = current.status
  if (!MOVES[from].has(to)) throw invalid(refusal(from, to))
  const dates: ActualDates = {
    actualStart: current.actualStart,
    actualFinish: current.actualFinish,
  }
  if (from === 'not-started') dates.actualStart = today()
  if (to === 'done') dates.actualFinish = today()
  if (from === 'done') dates.actualFinish = null
  return dates
}

function refusal(from: TaskStatus, to: TaskStatus): string {
  if (to === 'cancelled') return 'A task is cancelled by cancelling it, not by setting its status'
  if (from === 'cancelled') return 'The status of a cancelled task cannot be set'
  if (to === 'not-started') return 'A task cannot be set back to not started'
  return `A task ${LABEL[from]} cannot be set to ${LABEL[to]}`
}

const LABEL: Record<TaskStatus, string> = {
  'not-started': 'not started',
  'in-progress': 'in progress',
  'on-hold': 'on hold',
  done: 'done',
  cancelled: 'cancelled',
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
