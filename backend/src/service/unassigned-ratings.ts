import { and, asc, eq, inArray, isNotNull, ne, notExists, sql } from 'drizzle-orm'
import type { Database, Executor } from '../db/client.ts'
import {
  accounts,
  type Eligibility,
  type EligibilityOperand,
  taskAssignees,
  tasks,
} from '../db/schema.ts'
import { peopleOf } from './assignment.ts'
import type { Caller } from './caller.ts'
import {
  type AssignedTask,
  dailyLoads,
  readAbsences,
  readAssignedTasks,
} from './daily-person-load.ts'
import { ServiceError } from './errors.ts'
import { isOverloaded } from './overloads.ts'
import { taskPersonLoad } from './person-load.ts'
import { readCalendars } from './plan-scheduling.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { type Calendars, forbiddenDatesOf } from './scheduler.ts'
import { isUuid } from './system-admins.ts'
import { toDay } from './working-days.ts'

/** The colour an eligible but unassigned task is shown in by load (FR-045). */
export type LoadRating = 'red' | 'amber' | 'green'

/** One eligible but unassigned task of a project, with its rating (FR-045). */
export interface UnassignedTaskRating {
  taskId: string
  title: string
  plannedStart: string
  plannedFinish: string
  eligibility: Eligibility
  /**
   * Red when every valid combination of eligible people overloads someone, amber when some do and
   * others don't, green when none does (FR-045, SRC-201).
   */
  rating: LoadRating
}

/**
 * The rating of an eligibility expression (FR-045), given whether each person it names fits: can
 * take the task on with nobody overloaded. A valid combination is one way of meeting the
 * expression as it is written (DD-038): every operand of an AND, and one operand of each OR. A
 * combination overloads someone when one of its people does not fit.
 *
 * Every person the expression names is in at least one valid combination, so some combination
 * overloads someone exactly when some named person does not fit; and some combination fits
 * exactly when the expression holds with each person read as whether they fit. Where both hold,
 * the rating is amber (SRC-201).
 */
export function rateEligibility(
  eligibility: Eligibility,
  fitting: (person: string) => boolean,
): LoadRating {
  if (!holds(eligibility, fitting)) return 'red'
  return peopleOf(eligibility).every(fitting) ? 'green' : 'amber'
}

/** Whether the expression holds with each person read as `value(person)`. */
function holds(
  expression: Eligibility | EligibilityOperand,
  value: (person: string) => boolean,
): boolean {
  if (typeof expression === 'string') return value(expression)
  if ('all' in expression) return expression.all.every((operand) => holds(operand, value))
  return expression.any.some((operand) => holds(operand, value))
}

/** What one person's fit for the tasks they are eligible for is worked out from. */
export interface FitInputs {
  /** The person's assigned tasks that are not cancelled and not milestones. */
  tasks: readonly AssignedTask[]
  calendars: Calendars
  /** The person's absences, each a span of whole days. */
  absences: readonly { from: string; to: string }[]
  /** The person's capacity, a percentage. */
  capacity: number
}

/**
 * Whether `person` fits `task`: whether, with the task's load added to theirs on each of its
 * working days with them assigned, from its planned start to its planned finish, they are
 * overloaded on none of them (FR-042, SC-040). Their load and capacity are those of the daily
 * person load aggregator (SC-006): every task they are assigned to across all projects, and a
 * capacity of 0 on their absence days (FR-151).
 */
export function fits(
  task: { plannedStart: string; plannedFinish: string; load: number },
  person: string,
  inputs: FitInputs,
): boolean {
  const days = dailyLoads(task.plannedStart, task.plannedFinish, {
    ...inputs,
    readable: new Set(),
  })
  const forbidden = forbiddenDatesOf(inputs.calendars, [person])
  return days.every(
    (day) =>
      forbidden.has(toDay(day.date)) ||
      !isOverloaded(day.load + task.load, day.capacity ?? inputs.capacity),
  )
}

/**
 * The unassigned task load rating of the service layer (SC-041, DD-039). It rates each task with
 * an eligibility expression but no assigned people red, amber or green, by checking each valid
 * combination of eligible people in its eligibility tree (DD-038) against their load (FR-045):
 * red when every valid combination overloads someone, amber when some do and others don't, and
 * green when none does; where amber and green both hold, amber (SRC-201).
 *
 * Nothing is assigned or stored: the rating is computed when asked, from the plan as it is.
 * Anyone with a role in the project can read it, as they can its tasks (FR-106).
 */
export class UnassignedTaskRatingService {
  readonly #db: Database
  readonly #roles: ProjectRoleService

  constructor(db: Database, roles: ProjectRoleService) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * The rating of each task of the project that has an eligibility expression and no assigned
   * people, is not cancelled and has planned dates, in the order they were created. Refused as not
   * found if there is no such project, and as not visible to someone with no role in it (FR-017).
   */
  async ratingsOf(caller: Caller, projectId: string): Promise<UnassignedTaskRating[]> {
    if (!isUuid(projectId)) throw new ServiceError('not-found', 'There is no such project')
    await this.#roles.permissions.require(caller, projectId, 'read')
    // In one snapshot, so that the tasks, loads and calendars are read as of one moment.
    return this.#db.transaction((tx) => rate(tx, projectId), {
      isolationLevel: 'repeatable read',
      accessMode: 'read only',
    })
  }
}

async function rate(executor: Executor, projectId: string): Promise<UnassignedTaskRating[]> {
  const rows = await executor
    .select({
      taskId: tasks.id,
      title: tasks.title,
      plannedStart: sql<string>`${tasks.plannedStart}`,
      plannedFinish: sql<string>`${tasks.plannedFinish}`,
      eligibility: sql<Eligibility>`${tasks.eligibility}`,
      aiShare: tasks.aiShare,
      aiOnlyLoad: tasks.aiOnlyLoad,
      milestone: sql<boolean>`${tasks.milestoneVariant} is not null`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        ne(tasks.status, 'cancelled'),
        isNotNull(tasks.eligibility),
        isNotNull(tasks.plannedStart),
        isNotNull(tasks.plannedFinish),
        notExists(
          executor
            .select({ one: sql`1` })
            .from(taskAssignees)
            .where(eq(taskAssignees.taskId, tasks.id)),
        ),
      ),
    )
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
  const unassigned = rows.flatMap(({ aiShare, aiOnlyLoad, milestone, ...row }) => {
    // A milestone has no eligibility (FR-192) and no load (FR-191); should one have either, it is
    // not rated.
    const load = taskPersonLoad({ aiShare, aiOnlyLoad, milestone })
    return load === null ? [] : [{ ...row, load }]
  })
  if (unassigned.length === 0) return []

  // Each eligible person's load is read once, over every day of the tasks that name them.
  const spans = new Map<string, { from: string; to: string }>()
  for (const task of unassigned) {
    for (const person of peopleOf(task.eligibility)) {
      const span = spans.get(person)
      spans.set(person, {
        from: span && span.from < task.plannedStart ? span.from : task.plannedStart,
        to: span && span.to > task.plannedFinish ? span.to : task.plannedFinish,
      })
    }
  }
  const people = [...spans.keys()]
  const capacities = new Map(
    (
      await executor
        .select({ id: accounts.id, capacity: accounts.capacity })
        .from(accounts)
        .where(inArray(accounts.id, people))
    ).map((row) => [row.id, row.capacity]),
  )
  const inputs = new Map<string, FitInputs>()
  for (const [person, { from, to }] of spans) {
    const capacity = capacities.get(person)
    // Someone with no account can take nothing on; accounts are not deleted, so this is a guard.
    if (capacity === undefined) continue
    const assigned = await readAssignedTasks(executor, person, from, to)
    const calendars = await readCalendars(executor, [
      ...new Set([person, ...assigned.flatMap((task) => task.assignees)]),
    ])
    inputs.set(person, {
      tasks: assigned,
      calendars,
      absences: await readAbsences(executor, person, from, to),
      capacity,
    })
  }

  return unassigned.map(({ load, ...task }) => ({
    ...task,
    rating: rateEligibility(task.eligibility, (person) => {
      const given = inputs.get(person)
      return given !== undefined && fits({ ...task, load }, person, given)
    }),
  }))
}
