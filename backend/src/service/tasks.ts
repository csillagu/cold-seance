import { asc, eq } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import { tasks } from '../db/schema.ts'
import type { AuditLogService } from './audit.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { TaskStatus } from './permissions.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'

/**
 * A task as the service layer hands it out (FR-001). A task with neither a planned start nor a
 * planned finish is unscheduled; it stays a task of its project like any other (FR-003).
 *
 * Its eligibility expression and its assigned people are added by the eligibility and assignment
 * module (SC-005), and the planned finish its start and duration give by the scheduler (FR-144,
 * SC-004). `githubIssue` is the GitHub issue linked to the task: none until the task is assigned
 * to a repository and its issue is created (SC-036, SC-060), so always `null` for now.
 */
export interface Task {
  id: string
  projectId: string
  title: string
  description: string
  status: TaskStatus
  /** A date, `YYYY-MM-DD`, or `null` when the task has none. */
  plannedStart: string | null
  /** A date, `YYYY-MM-DD`, or `null` when the task has none. */
  plannedFinish: string | null
  /** The task's duration in whole working days (DD-006, FR-002), or `null` when it has none. */
  durationWorkingDays: number | null
  /** The task's effort, in the unit the tool states for it, or `null` when not given. */
  effort: number | null
  /** The share of the task done by AI, a percentage from 0 to 100, or `null` when not given. */
  aiShare: number | null
  githubIssue: null
}

/**
 * The fields of a task that its creator gives and an editor changes. Only the title is required
 * when a task is created; every other field may be left out, or given as `null` to clear it.
 */
export interface TaskFields {
  title: string
  description: string
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  effort: number | null
  aiShare: number | null
}

/**
 * The fields a task is created with or changed by, as a channel hands them over: any of them may
 * be left out, and the service checks each value given itself, whatever its type, so every
 * channel is held to the same rules (DD-039). `null` leaves a field unset, or clears it.
 */
export type TaskInput = { readonly [Field in keyof TaskFields]?: unknown }

/** The largest duration a task can have: the largest number its column holds. */
export const MAX_DURATION_WORKING_DAYS = 2_147_483_647

const FIELDS = [
  'title',
  'description',
  'plannedStart',
  'plannedFinish',
  'durationWorkingDays',
  'effort',
  'aiShare',
] as const satisfies readonly (keyof TaskFields)[]

const columns = {
  id: tasks.id,
  projectId: tasks.projectId,
  title: tasks.title,
  description: tasks.description,
  status: tasks.status,
  plannedStart: tasks.plannedStart,
  plannedFinish: tasks.plannedFinish,
  durationWorkingDays: tasks.durationWorkingDays,
  effort: tasks.effort,
  aiShare: tasks.aiShare,
} as const

type Row = Omit<Task, 'githubIssue'>

/**
 * The task record module of the service layer (DD-039, SC-001): it creates, edits, lists and reads
 * a project's tasks with their fields (FR-001), takes durations in whole working days only
 * (DD-006, FR-002), and keeps a task with no planned dates as an unscheduled task of its project,
 * in the project's one list of tasks, with no separate inbox (FR-003).
 *
 * Anyone who holds a role in the project may read its tasks (FR-106); only its read-write members
 * and admins may create and edit them (FR-108). Someone with no role in the project is told it is
 * not visible to them (FR-017). Each creation and edit is recorded in the audit log (FR-116), in
 * the transaction that makes it. A task's status is set by the status transitions (SC-003).
 */
export class TaskService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
  }

  /**
   * Creates a task in the project, not started. Refused as not visible to someone with no role in
   * the project, and as forbidden to someone whose role does not allow editing the plan; refused
   * as invalid if a field is not valid (see `validFields`).
   */
  async createTask(caller: Caller, projectId: string, task: TaskInput): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // In the transaction, so that the role still holds when the task is made; and before the
      // fields, so that a refusal tells nothing about what was sent.
      await this.#roles.permissions.require(caller, projectId, 'edit-plan', tx)
      // A title must be given, so a missing one is checked as an empty one.
      const fields = validFields({ ...task, title: task.title ?? '' }, UNSET)
      const [created] = await tx
        .insert(tasks)
        .values({ projectId, ...fields })
        .returning(columns)
      if (!created) throw new Error('The new task was not returned')
      await this.#audit.record(tx, caller, {
        action: 'task.created',
        subject: { type: 'task', id: created.id },
        projectId,
        details: { ...fields },
      })
      return withIssue(created)
    })
  }

  /**
   * Changes the given fields of the task, leaving the others as they are. Refused as not found if
   * there is no such task, as not visible to someone with no role in its project, and as
   * forbidden to someone whose role there does not allow editing the plan; refused as invalid if
   * a field is not valid, or if the task's planned finish would come before its planned start.
   */
  async updateTask(caller: Caller, taskId: string, changes: TaskInput): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // The role is checked before the task is locked, so that someone who may not edit it
      // cannot hold it up; then it is locked, so that two edits of one task cannot each check
      // against what the other changes. A task never changes project, so the check still holds.
      const found = await this.#find(taskId, tx, false)
      await this.#roles.permissions.require(caller, found.projectId, 'edit-plan', tx)
      const current = await this.#find(taskId, tx, true)
      const merged = validFields(changes, current)
      const changed = FIELDS.filter((field) => merged[field] !== current[field])
      if (changed.length === 0) return withIssue(current)
      const [updated] = await tx
        .update(tasks)
        .set(merged)
        .where(eq(tasks.id, taskId))
        .returning(columns)
      if (!updated) throw new Error('The edited task was not returned')
      await this.#audit.record(tx, caller, {
        action: 'task.updated',
        subject: { type: 'task', id: taskId },
        projectId: current.projectId,
        details: { changes: only(merged, changed), previous: only(current, changed) },
      })
      return withIssue(updated)
    })
  }

  /**
   * The task, for anyone who holds a role in its project (FR-106). Refused as not found if there
   * is no such task, and as not visible to someone with no role in its project (FR-017).
   */
  async getTask(caller: Caller, taskId: string): Promise<Task> {
    const task = await this.#find(taskId, this.#db, false)
    await this.#roles.permissions.require(caller, task.projectId, 'read')
    return withIssue(task)
  }

  /**
   * Every task of the project, scheduled or not, in the order they were created: one list, with
   * the unscheduled tasks in it like any other (FR-003). Refused as not visible to someone with
   * no role in the project (FR-017).
   */
  async listTasks(caller: Caller, projectId: string): Promise<Task[]> {
    await this.#roles.permissions.require(caller, projectId, 'read')
    const rows = await this.#db
      .select(columns)
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
    return rows.map(withIssue)
  }

  async #find(taskId: string, executor: Executor, lock: boolean): Promise<Row> {
    if (!isUuid(taskId)) throw noSuchTask()
    const query = executor.select(columns).from(tasks).where(eq(tasks.id, taskId))
    const [task] = lock ? await query.for('update') : await query
    if (!task) throw noSuchTask()
    return task
  }
}

function noSuchTask(): ServiceError {
  return new ServiceError('not-found', 'There is no such task')
}

function withIssue(row: Row): Task {
  return { ...row, githubIssue: null }
}

/** The given fields of a task, for the audit log. */
function only(fields: TaskFields, keys: readonly (keyof TaskFields)[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, fields[key]]))
}

/**
 * The task's fields: each one given in `input` checked, and each one left out taken from `base`.
 * The title is trimmed and put in one Unicode form. Whichever fields were given, the planned
 * finish, if any, must not come before the planned start, if any.
 *
 * - The title is required.
 * - The description is text.
 * - A planned start or finish is a calendar date, `YYYY-MM-DD`.
 * - A duration is a whole number of working days, at least one (DD-006, FR-002): no fraction of a
 *   day and no other unit is taken.
 * - Effort is a number of zero or more; the AI share a percentage from 0 to 100.
 */
function validFields(input: TaskInput, base: TaskFields): TaskFields {
  const given = <T>(value: unknown, check: (value: unknown) => T, otherwise: T): T =>
    value === undefined ? otherwise : check(value)
  const valid: TaskFields = {
    title: given(input.title, validTitle, base.title),
    description: given(input.description, validDescription, base.description),
    plannedStart: given(input.plannedStart, (v) => validDate(v, 'start'), base.plannedStart),
    plannedFinish: given(input.plannedFinish, (v) => validDate(v, 'finish'), base.plannedFinish),
    durationWorkingDays: given(input.durationWorkingDays, validDuration, base.durationWorkingDays),
    effort: given(input.effort, validEffort, base.effort),
    aiShare: given(input.aiShare, validAiShare, base.aiShare),
  }
  if (
    valid.plannedStart !== null &&
    valid.plannedFinish !== null &&
    valid.plannedFinish < valid.plannedStart
  ) {
    throw invalid("A task's planned finish cannot come before its planned start")
  }
  return valid
}

/** The fields of a task not yet given any: the base a new task's fields are checked against. */
const UNSET: TaskFields = {
  title: '',
  description: '',
  plannedStart: null,
  plannedFinish: null,
  durationWorkingDays: null,
  effort: null,
  aiShare: null,
}

function validTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  if (title === '') throw invalid('A task title is required')
  return title
}

function validDescription(value: unknown): string {
  if (typeof value !== 'string') throw invalid('A task description is text')
  return value
}

function validDate(value: unknown, which: 'start' | 'finish'): string | null {
  if (value === null) return null
  if (!isDate(value)) throw invalid(`A task's planned ${which} is a date, YYYY-MM-DD`)
  return value
}

function validDuration(value: unknown): number | null {
  if (value === null) return null
  if (
    !(typeof value === 'number' && Number.isInteger(value)) ||
    value < 1 ||
    value > MAX_DURATION_WORKING_DAYS
  ) {
    throw invalid("A task's duration is a whole number of working days, at least 1")
  }
  return value
}

function validEffort(value: unknown): number | null {
  if (value === null) return null
  if (!isFiniteNumber(value) || value < 0) {
    throw invalid("A task's effort is a number of zero or more")
  }
  return value
}

function validAiShare(value: unknown): number | null {
  if (value === null) return null
  if (!isFiniteNumber(value) || value < 0 || value > 100) {
    throw invalid("A task's AI share is a percentage from 0 to 100")
  }
  return value
}

function invalid(message: string): ServiceError {
  return new ServiceError('invalid', message)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Whether `value` is a calendar date, `YYYY-MM-DD`, from year 1 to 9999. */
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (year < 1) return false
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}
