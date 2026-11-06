import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { baselines, baselineTasks, tasks, type WEEKDAYS } from '../db/schema.ts'
import { type BaselineSummary, snapshotOf } from './baselines.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import { readCalendars } from './plan-scheduling.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'
import { type DayNumber, toDay, weekdayOf } from './working-days.ts'

/** A day of the week, as the global calendar names its weekend days. */
type Weekday = (typeof WEEKDAYS)[number]

/** A start and a finish, each `YYYY-MM-DD`, or null for none. */
export interface DatePair {
  start: string | null
  finish: string | null
}

/** A start and a finish variance, each in days, or null where it cannot be computed. */
export interface VariancePair {
  start: number | null
  finish: number | null
}

/**
 * One task's variance against a baseline (FR-066), with the dates it is computed from, side by
 * side (FR-152). A milestone lies on one day, which counts as both its start and its finish, as a
 * baseline keeps it.
 */
export interface TaskVariance {
  taskId: string
  title: string
  /** Whether the task is a milestone (FR-190). */
  milestone: boolean
  /** Its dates in the baseline; null if the task was created after the baseline was saved. */
  baseline: DatePair | null
  /** Its planned dates as they are now. */
  planned: DatePair
  /** Its actual start and finish, as the status transitions recorded them (FR-022, FR-023). */
  actual: DatePair
  /**
   * Each date's variance, in working days of the global calendar (SRC-244): the actual date, or the planned one where there is no
   * actual date yet, minus the baseline's. Positive is later than the baseline. Null where either
   * side has no date.
   */
  variance: VariancePair
}

/** A project's variance against one of its baselines: every task, in the order they were created. */
export interface BaselineVariance {
  baseline: BaselineSummary
  tasks: TaskVariance[]
}

/** The global calendar's working days (FR-010), which variance is counted in (SRC-244). */
export class GlobalWorkingDays {
  readonly #weekend: ReadonlySet<Weekday>
  /** The company holidays that fall on no weekend day, in date order. */
  readonly #holidays: readonly DayNumber[]

  constructor(calendar: { weekendDays: readonly Weekday[]; holidays: readonly string[] }) {
    this.#weekend = new Set(calendar.weekendDays)
    this.#holidays = [...new Set(calendar.holidays.map(toDay))]
      .filter((day) => !this.#weekend.has(weekdayOf(day)))
      .sort((a, b) => a - b)
  }

  /**
   * The working days from `from` to `to`, both `YYYY-MM-DD`: the working days after `from` up to
   * and including `to`, positive when `to` is later, negative when it is earlier. So the next
   * working day is +1 whatever weekend or holiday lies between, and a move onto a day off that
   * passes no working day is 0.
   */
  between(from: string, to: string): number {
    const a = toDay(from)
    const b = toDay(to)
    if (a === b) return 0
    return b > a ? this.#workingDaysIn(a + 1, b) : -this.#workingDaysIn(b + 1, a)
  }

  /** How many working days there are from `first` to `last`, both included. */
  #workingDaysIn(first: DayNumber, last: DayNumber): number {
    const days = last - first + 1
    const weeks = Math.floor(days / 7)
    // Each whole week holds every weekend day once; the days left over are looked at one by one.
    let weekend = weeks * this.#weekend.size
    for (let day = first + weeks * 7; day <= last; day++) {
      if (this.#weekend.has(weekdayOf(day))) weekend++
    }
    const holidays = this.#holidays.filter((day) => day >= first && day <= last).length
    return days - weekend - holidays
  }
}

/** The variance of one date: the actual date, or the planned one where there is none, minus the baseline's. */
export function dateVariance(
  days: GlobalWorkingDays,
  baseline: string | null,
  planned: string | null,
  actual: string | null,
): number | null {
  const current = actual ?? planned
  if (baseline === null || current === null) return null
  return days.between(baseline, current)
}

/**
 * The variance calculator of the service layer (SC-044, DD-039). It computes, when it is asked,
 * each task's and milestone's variance against a selected baseline: its actual dates, or its
 * current plan where it has none yet, minus the baseline's dates (FR-066). Nothing is stored
 * (DD-037), so the variance always follows the plan, the actual dates and the global calendar as
 * they are now, and the baseline itself is left as it was saved. It is counted in working days of
 * the global calendar, leaving out its weekend days and company holidays (SRC-244).
 *
 * Anyone with a role in the baseline's project can read it, as they can the baseline (FR-106).
 */
export class VarianceService {
  readonly #db: Database
  readonly #roles: ProjectRoleService

  constructor(db: Database, roles: ProjectRoleService) {
    this.#db = db
    this.#roles = roles
  }

  /**
   * The variance of the baseline's project against it: every task the project has now, those
   * created after the baseline included, with no variance where a date is missing. Refused as not
   * found if there is no such baseline, and as not visible to someone with no role in its project
   * (FR-017).
   */
  async varianceAgainst(caller: Caller, baselineId: string): Promise<BaselineVariance> {
    const baseline = isUuid(baselineId) ? await this.#find(baselineId) : undefined
    if (!baseline) throw new ServiceError('not-found', 'There is no such baseline')
    await this.#roles.permissions.require(caller, baseline.projectId, 'read')
    // In one snapshot, so that the plan, the actual dates and the calendar are read as of one
    // moment.
    const { rows, calendar } = await this.#db.transaction(
      async (tx) => ({
        calendar: await readCalendars(tx, []),
        rows: await tx
          .select({
            taskId: tasks.id,
            title: tasks.title,
            plannedStart: tasks.plannedStart,
            plannedFinish: tasks.plannedFinish,
            milestoneVariant: tasks.milestoneVariant,
            milestoneDate: tasks.milestoneDate,
            floatingDate: tasks.floatingDate,
            actualStart: tasks.actualStart,
            actualFinish: tasks.actualFinish,
            held: baselineTasks.taskId,
            baselineStart: baselineTasks.plannedStart,
            baselineFinish: baselineTasks.plannedFinish,
          })
          .from(tasks)
          .leftJoin(
            baselineTasks,
            and(eq(baselineTasks.taskId, tasks.id), eq(baselineTasks.baselineId, baseline.id)),
          )
          .where(eq(tasks.projectId, baseline.projectId))
          .orderBy(asc(tasks.createdAt), asc(tasks.id)),
      }),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
    const days = new GlobalWorkingDays(calendar)
    return {
      baseline,
      tasks: rows.map((row) => {
        const current = snapshotOf(row)
        const held =
          row.held === null ? null : { start: row.baselineStart, finish: row.baselineFinish }
        return {
          taskId: row.taskId,
          title: row.title,
          milestone: row.milestoneVariant !== null,
          baseline: held,
          planned: { start: current.plannedStart, finish: current.plannedFinish },
          actual: { start: row.actualStart, finish: row.actualFinish },
          variance: {
            start: dateVariance(days, held?.start ?? null, current.plannedStart, row.actualStart),
            finish: dateVariance(
              days,
              held?.finish ?? null,
              current.plannedFinish,
              row.actualFinish,
            ),
          },
        }
      }),
    }
  }

  async #find(baselineId: string): Promise<BaselineSummary | undefined> {
    const [row] = await this.#db
      .select({
        id: baselines.id,
        projectId: baselines.projectId,
        name: baselines.name,
        savedAt: baselines.createdAt,
      })
      .from(baselines)
      .where(eq(baselines.id, baselineId))
    return row
  }
}
