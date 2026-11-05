import { asc, eq } from 'drizzle-orm'
import type { Database, Executor, Transaction } from '../db/client.ts'
import { MILESTONE_VARIANTS, tasks } from '../db/schema.ts'
import {
  type Assignment,
  type AssignmentInput,
  assigneesColumn,
  type Eligibility,
  loadOverridesColumn,
  peopleOf,
  TaskAssignments,
} from './assignment.ts'
import type { AuditLogService } from './audit.ts'
import { lockPlan, PlanScheduling } from './plan-scheduling.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { TaskStatus } from './permissions.ts'
import {
  AI_ONLY_SHARE,
  type LoadOverrides,
  taskPersonLoad,
  validAiOnlyLoad,
} from './person-load.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { toDay } from './working-days.ts'

/**
 * A task as the service layer hands it out (FR-001). A task with neither a planned start nor a
 * planned finish is unscheduled; it stays a task of its project like any other (FR-003).
 *
 * Its eligibility expression and its assigned people are those of the eligibility and assignment
 * module (SC-005). Its planned dates are those the scheduler gives it (SC-004): the finish its
 * start and duration give (FR-144), the start its blockers give (FR-005), the span of its
 * subtasks (FR-006). `repositoryId` is the registered repository the task is assigned to, set by the
 * task repository assignment (SC-036, `TaskRepositoryService`). `githubIssue` is the GitHub issue
 * linked to the task: none until the task is assigned to a repository and its issue is created
 * (SRC-168, SC-060), so always `null` for now.
 *
 * `milestone` is `null` for a task that is not a milestone. A milestone (FR-190) takes no time, so
 * its planned dates, duration, effort and AI share are always `null` (FR-191); its date is the one
 * a fixed-date milestone is pinned to, or the one the scheduler places a floating milestone on.
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
  /**
   * The person-load percentage the task puts on each person assigned to it, over its whole
   * duration (DD-009): 100% minus its AI share (FR-032), or for an AI-only task the percentage it
   * was given, if any (FR-149); `null` for a milestone. An assignment may override it for its
   * person (`loadOverrides`).
   */
  personLoad: number | null
  milestone: Milestone | null
  /**
   * Who can do the task (FR-028): an AND (`all`) or OR (`any`) over people, by account id, at most
   * two levels deep (DD-038), or `null` when it has none. Always `null` for a milestone (FR-192).
   */
  eligibility: Eligibility | null
  /**
   * Who will do the task (FR-029): their account ids, in the order given; empty while nobody is
   * assigned. Always empty for a milestone (FR-192).
   */
  assignees: string[]
  /**
   * The person-load percentages that replace `personLoad` for single assignees (FR-033), by
   * account id, in the order of their ids; empty while none does.
   */
  loadOverrides: LoadOverrides
  /**
   * The people in its eligibility or its assignment who cannot read its project, each once,
   * eligibility first, so that the UI can mark them (FR-199). Such a person was written in when
   * they could read it and has lost access since; they stay until removed (FR-198).
   */
  withoutReadAccess: string[]
  /**
   * The date the task was started, `YYYY-MM-DD`, or `null` while it has not been (FR-022). Set by
   * the status transitions (SC-003), never by an edit.
   */
  actualStart: string | null
  /**
   * The date the task was finished, `YYYY-MM-DD`, or `null` while it is not finished (FR-023). Set
   * by the status transitions (SC-003), never by an edit.
   */
  actualFinish: string | null
  /**
   * The registered repository the task is assigned to, by its id in the tool, or `null` while it
   * is assigned to none (FR-141). Set by the task repository assignment (SC-036), never by an
   * edit.
   */
  repositoryId: string | null
  githubIssue: null
}

/** The variants of a milestone: pinned to a fixed date, or floating (FR-190). */
export type MilestoneVariant = (typeof MILESTONE_VARIANTS)[number]

/**
 * What makes a task a milestone (FR-190): pinned to a fixed date, with that date, `YYYY-MM-DD`; or
 * floating, with no date of its own, lying on the date the last of its blockers finishes, or on
 * none while none of them has a finish (FR-195, SC-004).
 */
export type Milestone =
  { variant: 'fixed-date'; date: string } | { variant: 'floating'; date: string | null }

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
  /**
   * The person-load percentage given to an AI-only task (FR-149); `null` for any other task, and
   * for an AI-only task given none. It is cleared when the task stops being AI-only.
   */
  aiOnlyLoad: number | null
  /** Whether the task is a milestone, and of which variant; `null` for a task that is not one. */
  milestoneVariant: MilestoneVariant | null
  /** The date a fixed-date milestone is pinned to; `null` for any other task. */
  milestoneDate: string | null
}

/**
 * The fields a task is created with or changed by, as a channel hands them over: any of them may
 * be left out, and the service checks each value given itself, whatever its type, so every
 * channel is held to the same rules (DD-039). `null` leaves a field unset, or clears it.
 */
export type TaskInput = {
  readonly [
    Field in Exclude<keyof TaskFields, 'milestoneVariant' | 'milestoneDate' | 'aiOnlyLoad'>
  ]?: unknown
} & {
  /**
   * The task's person-load percentage, which only an AI-only task can be given (FR-149); `null`
   * puts it back to the default, 100% minus the AI share (FR-032).
   */
  readonly personLoad?: unknown
  /**
   * Whether the task is a milestone, as `{ variant: 'fixed-date', date }` or `{ variant:
   * 'floating' }`, or `null` for a task that is not one (FR-190). It is chosen when the task is
   * created and cannot change after (FR-194); a fixed-date milestone's date can.
   */
  readonly milestone?: unknown
} & AssignmentInput

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
  'aiOnlyLoad',
  'milestoneVariant',
  'milestoneDate',
] as const satisfies readonly (keyof TaskFields)[]

/** The columns a task is read with: what `toTask` turns into a `Task`. */
export const taskColumns = {
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
  aiOnlyLoad: tasks.aiOnlyLoad,
  milestoneVariant: tasks.milestoneVariant,
  milestoneDate: tasks.milestoneDate,
  floatingDate: tasks.floatingDate,
  actualStart: tasks.actualStart,
  actualFinish: tasks.actualFinish,
  repositoryId: tasks.repositoryId,
  eligibility: tasks.eligibility,
  assignees: assigneesColumn,
  loadOverrides: loadOverridesColumn,
} as const

const columns = taskColumns

/** A task as it is read with `taskColumns`. */
export type TaskRow = Omit<Task, 'githubIssue' | 'milestone' | 'withoutReadAccess' | 'personLoad'> &
  Pick<TaskFields, 'milestoneVariant' | 'milestoneDate' | 'aiOnlyLoad'> & {
    floatingDate: string | null
  }

/**
 * The task record module of the service layer (DD-039, SC-001): it creates, edits, lists and reads
 * a project's tasks with their fields (FR-001), takes durations in whole working days only
 * (DD-006, FR-002), and keeps a task with no planned dates as an unscheduled task of its project,
 * in the project's one list of tasks, with no separate inbox (FR-003).
 *
 * Anyone who holds a role in the project may read its tasks (FR-106); only its read-write members
 * and admins may create and edit them (FR-108). Someone with no role in the project is told it is
 * not visible to them (FR-017). Each creation and edit is recorded in the audit log (FR-116), in
 * the transaction that makes it. A task's status, and its actual start and finish, are set by the
 * status transitions (SC-003, `TaskStatusService`), never by an edit.
 *
 * A task can be made a milestone when it is created, pinned to a fixed date or floating (FR-190).
 * A milestone takes no time: it has no planned dates, duration, effort or AI share (FR-191). A
 * task's kind and a milestone's variant cannot change once it is created, though a fixed-date
 * milestone's date can (FR-194).
 *
 * Who can do a task and who will are given with its other fields, and checked and stored by the
 * eligibility and assignment module (SC-005, `TaskAssignments`) in the same transaction.
 *
 * A task's person-load percentage, and the overrides of single assignments, follow the person-load
 * percentage rules (SC-039, `person-load.ts`).
 *
 * A task's planned dates are scheduled (SC-004, `PlanScheduling`) in the transaction that creates
 * or changes it: whenever its start, finish, duration or, for a fixed-date milestone, its date
 * changes, it and every task of its project that depends on it are scheduled again. A change of
 * its assigned people, or of any other field, schedules nothing, so it moves no task (FR-148). A
 * change that sets a task's start, finish or milestone date on one of its forbidden dates is
 * refused (FR-011).
 */
export class TaskService {
  readonly #db: Database
  readonly #audit: AuditLogService
  readonly #roles: ProjectRoleService
  readonly #assignments: TaskAssignments
  readonly #scheduling: PlanScheduling

  constructor(db: Database, audit: AuditLogService, roles: ProjectRoleService) {
    this.#db = db
    this.#audit = audit
    this.#roles = roles
    this.#assignments = new TaskAssignments(roles)
    this.#scheduling = new PlanScheduling(audit)
  }

  /**
   * Creates a task in the project, not started. Refused as not visible to someone with no role in
   * the project, and as forbidden to someone whose role does not allow editing the plan; refused
   * as invalid if a field is not valid (see `validFields`), including a milestone given a planned
   * date, duration, effort or AI share (FR-191); and refused as invalid if its eligibility or
   * assignees are not valid, are given to a milestone, or name someone who cannot read the
   * project (`TaskAssignments.check`). Refused as invalid, too, if its planned start, its planned
   * finish or a fixed-date milestone's date is one of its forbidden dates (FR-011). Its planned
   * finish is the one its start and duration give, if it has both (FR-144).
   */
  async createTask(caller: Caller, projectId: string, task: TaskInput): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // In the transaction, so that the role still holds when the task is made; and before the
      // fields, so that a refusal tells nothing about what was sent.
      await this.#roles.permissions.require(caller, projectId, 'edit-plan', tx)
      await lockPlan(tx, projectId)
      // A title must be given, so a missing one is checked as an empty one.
      const fields = validFields({ ...task, title: task.title ?? '' }, UNSET, 'create')
      const assignment = await this.#assignments.check(
        tx,
        projectId,
        fields.milestoneVariant !== null,
        task,
        NO_ASSIGNMENT,
      )
      await this.#refuseForbidden(tx, fields, UNSET, assignment.assignees)
      const [created] = await tx
        .insert(tasks)
        .values({ projectId, ...fields, eligibility: assignment.eligibility })
        .returning({ id: tasks.id })
      if (!created) throw new Error('The new task was not returned')
      await this.#assignments.store(tx, created.id, assignment)
      const cause = { action: 'task.created', taskId: created.id }
      await this.#scheduling.reschedule(tx, caller, projectId, [created.id], cause, created.id)
      const scheduled = await this.#find(created.id, tx, false)
      await this.#audit.record(tx, caller, {
        action: 'task.created',
        subject: { type: 'task', id: created.id },
        projectId,
        details: {
          ...fields,
          plannedStart: scheduled.plannedStart,
          plannedFinish: scheduled.plannedFinish,
          ...assignment,
        },
      })
      return this.#out(tx, scheduled)
    })
  }

  /**
   * Changes the given fields of the task, leaving the others as they are. Refused as not found if
   * there is no such task, as not visible to someone with no role in its project, and as
   * forbidden to someone whose role there does not allow editing the plan; refused as invalid if
   * a field is not valid, or if the task's planned finish would come before its planned start;
   * refused as invalid too if the change would make the task a milestone or not one, or change a
   * milestone's variant (FR-194). Refused as invalid, too, if the eligibility or assignees given
   * are not valid, are given to a milestone, or add someone who cannot read the project
   * (`TaskAssignments.check`). Refused as invalid, too, if it moves the task's planned start, its
   * planned finish or a fixed-date milestone's date onto one of the task's forbidden dates
   * (FR-011). A change of its start, finish, duration or milestone date schedules it and the
   * tasks that depend on it again (SC-004).
   */
  async updateTask(caller: Caller, taskId: string, changes: TaskInput): Promise<Task> {
    return this.#db.transaction(async (tx) => {
      // The role is checked before the task is locked, so that someone who may not edit it
      // cannot hold it up; then the plan and the task are locked, so that two edits of one task
      // cannot each check against what the other changes, and the scheduling sees every change of
      // the plan before it. A task never changes project, so the check still holds.
      const found = await this.#find(taskId, tx, false)
      await this.#roles.permissions.require(caller, found.projectId, 'edit-plan', tx)
      await lockPlan(tx, found.projectId)
      const current = await this.#find(taskId, tx, true)
      const merged = validFields(changes, current, 'update')
      const assignment = await this.#assignments.check(
        tx,
        current.projectId,
        merged.milestoneVariant !== null,
        changes,
        current,
      )
      const next = { ...merged, ...assignment }
      const given = [...FIELDS, ...ASSIGNMENT_FIELDS].filter(
        (field) => !same(next[field], current[field]),
      )
      if (given.length === 0) return this.#out(tx, current)
      await this.#refuseForbidden(tx, merged, current, assignment.assignees)
      await tx
        .update(tasks)
        .set({ ...merged, eligibility: assignment.eligibility })
        .where(eq(tasks.id, taskId))
      if (given.includes('assignees') || given.includes('loadOverrides')) {
        await this.#assignments.store(tx, taskId, assignment)
      }
      if (given.some((field) => SCHEDULED_FIELDS.has(field))) {
        const cause = { action: 'task.updated', taskId }
        await this.#scheduling.reschedule(tx, caller, current.projectId, [taskId], cause, taskId)
      }
      const updated = await this.#find(taskId, tx, false)
      const changed = [...FIELDS, ...ASSIGNMENT_FIELDS].filter(
        (field) => !same(updated[field], current[field]),
      )
      // The scheduler can set back what the edit gave, such as the start of a task its blockers
      // set: then nothing changed.
      if (changed.length === 0) return this.#out(tx, updated)
      await this.#audit.record(tx, caller, {
        action: 'task.updated',
        subject: { type: 'task', id: taskId },
        projectId: current.projectId,
        details: { changes: only(updated, changed), previous: only(current, changed) },
      })
      return this.#out(tx, updated)
    })
  }

  /**
   * The task, for anyone who holds a role in its project (FR-106). Refused as not found if there
   * is no such task, and as not visible to someone with no role in its project (FR-017).
   */
  async getTask(caller: Caller, taskId: string): Promise<Task> {
    const task = await this.#find(taskId, this.#db, false)
    await this.#roles.permissions.require(caller, task.projectId, 'read')
    return this.#out(this.#db, task)
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
    return toTasks(this.#assignments, this.#db, projectId, rows)
  }

  #out(executor: Executor, row: TaskRow): Promise<Task> {
    return toCompleteTask(this.#assignments, executor, row)
  }

  /**
   * Refuses the task's fields if a date they set, unlike `base`, is one of the task's forbidden
   * dates with the given assigned people (FR-011): its planned start, its planned finish unless
   * its duration gives it (FR-144), or a fixed-date milestone's date.
   */
  async #refuseForbidden(
    tx: Transaction,
    fields: TaskFields,
    base: TaskFields,
    assignees: readonly string[],
  ): Promise<void> {
    const set = (
      [
        ['planned start', fields.plannedStart, base.plannedStart],
        [
          'planned finish',
          fields.durationWorkingDays === null ? fields.plannedFinish : null,
          base.plannedFinish,
        ],
        ['milestone date', fields.milestoneDate, base.milestoneDate],
      ] as const
    ).filter(([, date, before]) => date !== null && date !== before)
    if (set.length === 0) return
    const forbidden = await this.#scheduling.forbiddenDates(tx, assignees)
    for (const [what, date] of set) {
      if (date !== null && forbidden.has(toDay(date))) {
        throw invalid(
          `The task's ${what} cannot be ${date}: that is a non-working day for the task, a ` +
            'weekend day, a company holiday or a day off of someone assigned to it',
        )
      }
    }
  }

  async #find(taskId: string, executor: Executor, lock: boolean): Promise<TaskRow> {
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

/**
 * The tasks of one project that rows read with `taskColumns` hold, as the service layer hands them
 * out, each with the people in it who cannot read the project (FR-199), read with `executor`.
 */
export async function toTasks(
  assignments: TaskAssignments,
  executor: Executor,
  projectId: string,
  rows: readonly TaskRow[],
): Promise<Task[]> {
  const people = rows.flatMap(namedIn)
  const without = await assignments.withoutReadAccess(executor, projectId, people)
  return rows.map((row) => toTask(row, without))
}

/** The task a row read with `taskColumns` holds, as `toTasks` hands it out. */
export async function toCompleteTask(
  assignments: TaskAssignments,
  executor: Executor,
  row: TaskRow,
): Promise<Task> {
  return toTask(row, await assignments.withoutReadAccess(executor, row.projectId, namedIn(row)))
}

/** Everyone a task's eligibility and assignment name, each once, eligibility first. */
function namedIn(row: Pick<TaskRow, 'eligibility' | 'assignees'>): string[] {
  return [...new Set([...peopleOf(row.eligibility), ...row.assignees])]
}

function toTask(
  { milestoneVariant, milestoneDate, floatingDate, aiOnlyLoad, ...row }: TaskRow,
  without: ReadonlySet<string>,
): Task {
  return {
    ...row,
    personLoad: taskPersonLoad({
      aiShare: row.aiShare,
      aiOnlyLoad,
      milestone: milestoneVariant !== null,
    }),
    milestone: milestoneOf(milestoneVariant, milestoneDate, floatingDate),
    withoutReadAccess: namedIn(row).filter((person) => without.has(person)),
    githubIssue: null,
  }
}

function milestoneOf(
  variant: MilestoneVariant | null,
  date: string | null,
  floatingDate: string | null,
): Milestone | null {
  if (variant === null) return null
  if (variant === 'floating') return { variant, date: floatingDate }
  // Cannot happen: the table holds a date for every fixed-date milestone
  // (tasks_milestone_date_iff_fixed).
  if (date === null) throw new Error('A fixed-date milestone was stored without its date')
  return { variant, date }
}

/** The given fields of a task, for the audit log. */
function only<F extends TaskFields & Assignment>(
  fields: F,
  keys: readonly (keyof F)[],
): Record<string, unknown> {
  return Object.fromEntries(keys.map((key) => [key, fields[key]]))
}

/** The fields whose change schedules the task again (SC-004). */
const SCHEDULED_FIELDS: ReadonlySet<string> = new Set([
  'plannedStart',
  'plannedFinish',
  'durationWorkingDays',
  'milestoneDate',
])

const ASSIGNMENT_FIELDS = [
  'eligibility',
  'assignees',
  'loadOverrides',
] as const satisfies readonly (keyof Assignment)[]

/** No eligibility and nobody assigned: the assignment a new task's is checked against. */
const NO_ASSIGNMENT: Assignment = { eligibility: null, assignees: [], loadOverrides: {} }

/** Whether two values of a task's field are the same: equal, or equal as JSON for a tree or list. */
function same(a: unknown, b: unknown): boolean {
  return a === b || (typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))
}

/**
 * The task's fields: each one given in `input` checked, and each one left out taken from `base`.
 * The title is trimmed and put in one Unicode form. Whichever fields were given, the planned
 * finish, if any, must not come before the planned start, if any.
 *
 * - The title is required.
 * - The description is text.
 * - A planned start or finish is a calendar date, `YYYY-MM-DD`.
 * - A task with a start and a duration takes no finish of its own: the scheduler derives it
 *   (FR-144, SC-004).
 * - A duration is a whole number of working days, at least one (DD-006, FR-002): no fraction of a
 *   day and no other unit is taken.
 * - Effort is a number of zero or more; the AI share a percentage from 0 to 100.
 * - Only an AI-only task can be given a person-load percentage, any number of zero or more
 *   (FR-149); any other task's is 100% minus its AI share (FR-032). A task that stops being
 *   AI-only loses the one it was given.
 * - A milestone is fixed-date, with a date, or floating, with none (FR-190). It is chosen when the
 *   task is created and cannot change after, nor its variant; a fixed-date milestone's date can
 *   (FR-194). Whichever fields were given, a milestone has no planned dates, duration, effort or
 *   AI share (FR-191).
 */
function validFields(input: TaskInput, base: TaskFields, action: 'create' | 'update'): TaskFields {
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
    aiOnlyLoad: null,
    ...given(input.milestone, (v) => validMilestone(v, base, action), {
      milestoneVariant: base.milestoneVariant,
      milestoneDate: base.milestoneDate,
    }),
  }
  valid.aiOnlyLoad = given(
    input.personLoad,
    (v) => validAiOnlyLoad(v, valid.aiShare),
    valid.aiShare === AI_ONLY_SHARE ? base.aiOnlyLoad : null,
  )
  if (valid.plannedStart !== null && valid.durationWorkingDays !== null) {
    // The scheduler derives the finish from the start and the duration (FR-144): a finish given
    // is not taken, and the one a new start or duration no longer gives is cleared for it to set.
    const moved =
      valid.plannedStart !== base.plannedStart ||
      valid.durationWorkingDays !== base.durationWorkingDays
    valid.plannedFinish = moved ? null : base.plannedFinish
  }
  if (
    valid.milestoneVariant !== null &&
    (valid.plannedStart !== null ||
      valid.plannedFinish !== null ||
      valid.durationWorkingDays !== null ||
      valid.effort !== null ||
      valid.aiShare !== null)
  ) {
    throw invalid(
      'A milestone takes no time: it has no planned start or finish, duration, effort or AI share',
    )
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
  aiOnlyLoad: null,
  milestoneVariant: null,
  milestoneDate: null,
}

type MilestoneFields = Pick<TaskFields, 'milestoneVariant' | 'milestoneDate'>

/**
 * The milestone fields `value` gives: none for `null`, a task that is not a milestone. When a task
 * is edited, its kind and its variant must stay as they were (FR-194).
 */
function validMilestone(
  value: unknown,
  base: TaskFields,
  action: 'create' | 'update',
): MilestoneFields {
  const fields = milestoneFields(value)
  if (action === 'update') {
    if ((fields.milestoneVariant === null) !== (base.milestoneVariant === null)) {
      throw invalid(
        base.milestoneVariant === null
          ? 'A task cannot be made a milestone once it is created'
          : 'A milestone cannot be made a task that is not a milestone',
      )
    }
    if (fields.milestoneVariant !== base.milestoneVariant) {
      throw invalid("A milestone's variant, fixed-date or floating, cannot be changed")
    }
  }
  return fields
}

function milestoneFields(value: unknown): MilestoneFields {
  if (value === null) return { milestoneVariant: null, milestoneDate: null }
  const { variant, date } =
    typeof value === 'object' && !Array.isArray(value)
      ? (value as { variant?: unknown; date?: unknown })
      : { variant: undefined, date: undefined }
  if (variant === 'fixed-date') {
    if (!isDate(date)) throw invalid('A fixed-date milestone is pinned to a date, YYYY-MM-DD')
    return { milestoneVariant: variant, milestoneDate: date }
  }
  if (variant === 'floating') {
    if (date !== undefined && date !== null) {
      throw invalid('A floating milestone has no date of its own')
    }
    return { milestoneVariant: variant, milestoneDate: null }
  }
  throw invalid("A milestone's variant is fixed-date or floating")
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
