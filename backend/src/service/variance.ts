import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { baselines, baselineTasks, tasks } from '../db/schema.ts'
import { type BaselineSummary, snapshotOf } from './baselines.ts'
import type { Caller } from './caller.ts'
import { ServiceError } from './errors.ts'
import type { ProjectRoleService } from './project-roles.ts'
import { isUuid } from './system-admins.ts'

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
   * Each date's variance, in calendar days: the actual date, or the planned one where there is no
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

const DAY_MS = 24 * 60 * 60 * 1000

/** The calendar days from `from` to `to`, both `YYYY-MM-DD`: positive when `to` is later. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS)
}

/** The variance of one date: the actual date, or the planned one where there is none, minus the baseline's. */
export function dateVariance(
  baseline: string | null,
  planned: string | null,
  actual: string | null,
): number | null {
  const current = actual ?? planned
  if (baseline === null || current === null) return null
  return daysBetween(baseline, current)
}

/**
 * The variance calculator of the service layer (SC-044, DD-039). It computes, when it is asked,
 * each task's and milestone's variance against a selected baseline: its actual dates, or its
 * current plan where it has none yet, minus the baseline's dates (FR-066). Nothing is stored
 * (DD-037), so the variance always follows the plan and the actual dates as they are now, and
 * the baseline itself is left as it was saved.
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
    // One statement, so that the plan and the actual dates are read as of one moment.
    const rows = await this.#db
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
      .orderBy(asc(tasks.createdAt), asc(tasks.id))
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
            start: dateVariance(held?.start ?? null, current.plannedStart, row.actualStart),
            finish: dateVariance(held?.finish ?? null, current.plannedFinish, row.actualFinish),
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
