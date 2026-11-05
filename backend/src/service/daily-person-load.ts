import { and, asc, eq, gte, lte, ne, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { absences, accounts, taskAssignees, tasks } from '../db/schema.ts'
import { assigneesColumn } from './assignment.ts'
import type { Caller } from './caller.ts'
import { isDate } from './dates.ts'
import { ServiceError } from './errors.ts'
import { readCalendars } from './plan-scheduling.ts'
import { isOverloaded } from './overloads.ts'
import { taskPersonLoad } from './person-load.ts'
import { type Calendars, forbiddenDatesOf } from './scheduler.ts'
import { isUuid } from './system-admins.ts'
import { fromDay, toDay } from './working-days.ts'
import type { ViewReadFilter } from './view-filter.ts'

/** A task's share of a person's load on one day, as a viewer who can read its project sees it. */
export interface TaskLoad {
  taskId: string
  projectId: string
  title: string
  /** The person-load percentage the task puts on the person that day. */
  load: number
}

/** A person's load on one day (FR-036), as one viewer sees it (FR-046, DD-014). */
export interface DayLoad {
  /** The day, `YYYY-MM-DD`. */
  date: string
  /** The person's whole load that day, across all projects, a percentage. */
  load: number
  /** The tasks behind it in projects the viewer can read, in the order they were created. */
  tasks: TaskLoad[]
  /** The load from projects the viewer cannot read, as a percentage alone. */
  otherProjects: number
  /**
   * The person's capacity that day, a percentage: 0 on an absence day (FR-151), their capacity
   * otherwise; `null` for a viewer who may not read the person's capacity.
   */
  capacity: number | null
  /**
   * Whether the person is overloaded that day: their load is above their capacity (FR-042,
   * SC-040). `null` for a viewer who may not read the person's capacity, as it would tell them
   * something of it.
   */
  overloaded: boolean | null
}

/** A person's load over a span of days. */
export interface PersonLoad {
  accountId: string
  from: string
  to: string
  /** One entry for each day from `from` to `to`, both included, in order. */
  days: DayLoad[]
}

/** The most days one request for a person's load may span. */
export const MAX_LOAD_DAYS = 366

/** One assigned task of the person, with what its load is worked out from. */
export interface AssignedTask {
  id: string
  projectId: string
  title: string
  plannedStart: string
  plannedFinish: string
  /** The person-load percentage the task puts on the person (FR-034, DD-009, DD-010). */
  load: number
  /** Everyone assigned to it, whose days off are its forbidden dates (FR-008). */
  assignees: readonly string[]
}

/** What one person's daily load is worked out from. */
export interface LoadInputs {
  /** The person's assigned tasks that are not cancelled and not milestones. */
  tasks: readonly AssignedTask[]
  calendars: Calendars
  /** The person's absences, each a span of whole days. */
  absences: readonly { from: string; to: string }[]
  /** The person's capacity, or `null` if the viewer may not read it. */
  capacity: number | null
  /** The projects of the tasks the viewer can read. */
  readable: ReadonlySet<string>
}

/**
 * The daily load of one person from `from` to `to`, both included: on each day, the load of each
 * task they are assigned to that is active that day, summed across all projects (FR-036). A task
 * is active on its working days from its planned start to its planned finish: the days between
 * them that are not its forbidden dates (the owner's decision of 2026-11-05), and on each it puts
 * its whole percentage, or the person's override, on the person (FR-034). The tasks behind the
 * load are given for the projects in `readable`, and the rest only as a percentage (FR-046). The
 * person's capacity is 0 on each day of their absences (FR-151). Each day on which the load is above
 * the capacity is marked overloaded (FR-042, SC-040), if the capacity is given.
 */
export function dailyLoads(from: string, to: string, inputs: LoadInputs): DayLoad[] {
  const first = toDay(from)
  const last = toDay(to)
  const days: DayLoad[] = []
  for (let day = first; day <= last; day++) {
    days.push({
      date: fromDay(day),
      load: 0,
      tasks: [],
      otherProjects: 0,
      capacity: inputs.capacity,
      overloaded: null,
    })
  }
  /** The entries of the days from `start` to `finish` inside the span, each with its day. */
  const within = (start: string, finish: string) => {
    const begin = Math.max(first, toDay(start))
    const end = Math.min(last, toDay(finish))
    if (begin > end) return []
    return days.slice(begin - first, end - first + 1).map((entry, i) => ({ day: begin + i, entry }))
  }
  for (const task of inputs.tasks) {
    const forbidden = forbiddenDatesOf(inputs.calendars, task.assignees)
    const readable = inputs.readable.has(task.projectId)
    for (const { day, entry } of within(task.plannedStart, task.plannedFinish)) {
      if (forbidden.has(day)) continue
      entry.load += task.load
      if (readable) {
        entry.tasks.push({
          taskId: task.id,
          projectId: task.projectId,
          title: task.title,
          load: task.load,
        })
      } else {
        entry.otherProjects += task.load
      }
    }
  }
  if (inputs.capacity !== null) {
    for (const absence of inputs.absences) {
      for (const { entry } of within(absence.from, absence.to)) entry.capacity = 0
    }
  }
  for (const entry of days) {
    if (entry.capacity !== null) entry.overloaded = isOverloaded(entry.load, entry.capacity)
  }
  return days
}

/** Answers whether the caller may read a person's capacity, as the calendar module decides. */
export interface CapacityReader {
  capacityOf(caller: Caller, accountId: string): Promise<{ capacity: number }>
}

/**
 * The daily person load aggregator of the service layer (SC-006, DD-039). It computes a person's
 * load on each day: the load of every task they are assigned to, and no one else is (FR-035), that
 * is not cancelled (FR-127) and is active that day, applied over the task's whole duration
 * (FR-034, DD-009, DD-010) and summed across all projects (FR-036).
 *
 * Every viewer with an account sees a person's whole load; the exact tasks behind it only for the
 * projects the viewer can read, as the view read filter decides (SC-050), and the load from other
 * projects only as a percentage (FR-046, DD-014). The capacity of each day, 0 on the person's
 * absence days (FR-151), is given to the viewers who may read the person's capacity (the owner's
 * decision of 2026-11-05), and to no one else.
 */
export class DailyPersonLoadService {
  readonly #db: Database
  readonly #viewFilter: ViewReadFilter
  readonly #capacities: CapacityReader

  constructor(db: Database, viewFilter: ViewReadFilter, capacities: CapacityReader) {
    this.#db = db
    this.#viewFilter = viewFilter
    this.#capacities = capacities
  }

  /**
   * The person's load on each day from `span.from` to `span.to`, both included, `YYYY-MM-DD`, at
   * most `MAX_LOAD_DAYS` days, as the caller may see it.
   */
  async loadOf(
    caller: Caller,
    accountId: string,
    span: { from?: unknown; to?: unknown },
  ): Promise<PersonLoad> {
    await this.#requireAccount(caller)
    const { from, to } = validSpan(span)
    if (!isUuid(accountId)) throw noSuchAccount()
    const [person] = await this.#db
      .select({ capacity: accounts.capacity })
      .from(accounts)
      .where(eq(accounts.id, accountId))
    if (!person) throw noSuchAccount()

    // A task is read only with both its dates, which the comparisons below require, so they are
    // typed as present.
    const rows = await this.#db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        title: tasks.title,
        plannedStart: sql<string>`${tasks.plannedStart}`,
        plannedFinish: sql<string>`${tasks.plannedFinish}`,
        aiShare: tasks.aiShare,
        aiOnlyLoad: tasks.aiOnlyLoad,
        milestone: sql<boolean>`${tasks.milestoneVariant} is not null`,
        loadOverride: taskAssignees.loadOverride,
        assignees: assigneesColumn,
      })
      .from(taskAssignees)
      .innerJoin(tasks, eq(tasks.id, taskAssignees.taskId))
      .where(
        and(
          eq(taskAssignees.accountId, accountId),
          ne(tasks.status, 'cancelled'),
          lte(tasks.plannedStart, to),
          gte(tasks.plannedFinish, from),
        ),
      )
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
    const assigned: AssignedTask[] = rows.flatMap(({ aiShare, aiOnlyLoad, milestone, ...row }) => {
      // A milestone takes no time, so it has no load (FR-191). None is read here, since a
      // milestone has no planned dates (tasks_milestone_takes_no_time), but should one be, it
      // counts for nothing.
      const own = taskPersonLoad({ aiShare, aiOnlyLoad, milestone })
      if (own === null) return []
      const { loadOverride, ...task } = row
      return [{ ...task, load: loadOverride ?? own }]
    })

    const people = [...new Set(assigned.flatMap((task) => task.assignees))]
    const calendars = await readCalendars(this.#db, people)
    const readable = new Set(
      (await this.#viewFilter.readable(caller, assigned)).map((task) => task.projectId),
    )
    const capacity = (await this.#mayReadCapacity(caller, accountId)) ? person.capacity : null
    const absent =
      capacity === null
        ? []
        : await this.#db
            .select({ from: absences.startsOn, to: absences.endsOn })
            .from(absences)
            .where(
              and(
                eq(absences.accountId, accountId),
                lte(absences.startsOn, to),
                gte(absences.endsOn, from),
              ),
            )

    return {
      accountId,
      from,
      to,
      days: dailyLoads(from, to, {
        tasks: assigned,
        calendars,
        absences: absent,
        capacity,
        readable,
      }),
    }
  }

  async #mayReadCapacity(caller: Caller, accountId: string): Promise<boolean> {
    try {
      await this.#capacities.capacityOf(caller, accountId)
      return true
    } catch (error) {
      if (error instanceof ServiceError && error.kind === 'forbidden') return false
      throw error
    }
  }

  async #requireAccount(caller: Caller): Promise<void> {
    const [account] = isUuid(caller.accountId)
      ? await this.#db
          .select({ id: accounts.id })
          .from(accounts)
          .where(eq(accounts.id, caller.accountId))
      : []
    if (!account) {
      throw new ServiceError('forbidden', "Only people with an account can see a person's load")
    }
  }
}

/**
 * The span of days a request for a person's load covers: two dates, `YYYY-MM-DD`, the second not
 * before the first, at most `MAX_LOAD_DAYS` days. Exported for its unit tests.
 */
export function validSpan(span: { from?: unknown; to?: unknown }): { from: string; to: string } {
  const { from, to } = span
  if (!isDate(from) || !isDate(to)) {
    throw new ServiceError(
      'invalid',
      "A person's load is asked for from one day to another, each a date, YYYY-MM-DD",
    )
  }
  if (to < from) throw new ServiceError('invalid', 'The last day cannot be before the first')
  if (toDay(to) - toDay(from) + 1 > MAX_LOAD_DAYS) {
    throw new ServiceError(
      'invalid',
      `A person's load is given for at most ${MAX_LOAD_DAYS} days at a time`,
    )
  }
  return { from, to }
}

function noSuchAccount(): ServiceError {
  return new ServiceError('not-found', 'There is no such account')
}
