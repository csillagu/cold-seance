import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Executor, Transaction } from '../db/client.ts'
import {
  companyHolidays,
  globalCalendar,
  personalHolidays,
  taskBlockedBy,
  tasks,
} from '../db/schema.ts'
import { assigneesColumn } from './assignment.ts'
import type { Actor, AuditLogService } from './audit.ts'
import {
  type Calendars,
  forbiddenDatesOf,
  type Plan,
  schedule,
  type ScheduledDates,
} from './scheduler.ts'
import { DEFAULT_WEEKEND_DAYS, type ForbiddenDates } from './working-days.ts'

/**
 * The class of the transaction-level advisory locks on a project's plan; the project's id picks
 * the lock within it. A two-key lock, so that it never meets the relations lock, which has one.
 */
const PLAN_LOCK_CLASS = 0x5c_00_04

/**
 * Takes the lock on the project's plan for the rest of the transaction, so that two changes of
 * one project's plan are scheduled one after the other, each against what the other did. Every
 * module that schedules takes it before it locks a task's row, and after the relations lock if it
 * takes that, so that the locks are always taken in one order.
 */
export async function lockPlan(tx: Transaction, projectId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${PLAN_LOCK_CLASS}::integer, hashtext(${projectId}))`,
  )
}

const planColumns = {
  id: tasks.id,
  title: tasks.title,
  parentId: tasks.parentId,
  plannedStart: tasks.plannedStart,
  plannedFinish: tasks.plannedFinish,
  durationWorkingDays: tasks.durationWorkingDays,
  milestoneVariant: tasks.milestoneVariant,
  milestoneDate: tasks.milestoneDate,
  floatingDate: tasks.floatingDate,
  assignees: assigneesColumn,
} as const

/**
 * Runs the scheduler (SC-004, `schedule`) over a project's plan in the database: it reads the
 * project's tasks, their blocked-by relations within the project and the calendars, schedules
 * what a change touched, and stores the dates of every task that moved, in the transaction of the
 * change. Each task it moves, other than the one the change was made to, gets an entry of its own
 * in the audit log, in the project, by whoever made the change (FR-116).
 *
 * It reads and writes the one project only, so nothing it does reaches another project's plan
 * (FR-018).
 */
export class PlanScheduling {
  readonly #audit: AuditLogService

  constructor(audit: AuditLogService) {
    this.#audit = audit
  }

  /**
   * Schedules again the tasks of the project `changed` names, and every task that depends on one
   * of them, and stores what moved. The caller holds the project's plan lock (`lockPlan`).
   * Answers the new dates of every task that moved. The moves of the task `recordedBy` names are
   * left for the caller to record with the change it made to that task.
   */
  async reschedule(
    tx: Transaction,
    caller: Actor,
    projectId: string,
    changed: readonly string[],
    cause: { action: string; taskId: string },
    recordedBy: string | null = null,
  ): Promise<Map<string, ScheduledDates>> {
    if (changed.length === 0) return new Map()
    const plan = await readPlan(tx, projectId)
    const assignees = [...new Set(plan.tasks.flatMap((task) => task.assignees))]
    const moved = schedule(plan, await readCalendars(tx, assignees), changed)
    // In the plan's order, so that the entries come in the order the tasks were created.
    for (const previous of plan.tasks) {
      const dates = moved.get(previous.id)
      if (!dates) continue
      await tx.update(tasks).set(dates).where(eq(tasks.id, previous.id))
      if (previous.id === recordedBy) continue
      await this.#audit.record(tx, caller, {
        action: 'task.rescheduled',
        subject: { type: 'task', id: previous.id },
        projectId,
        details: {
          changes: dates,
          previous: {
            plannedStart: previous.plannedStart,
            plannedFinish: previous.plannedFinish,
            floatingDate: previous.floatingDate,
          },
          cause,
        },
      })
    }
    return moved
  }

  /** The forbidden dates of a task with the given assigned people (FR-007 to FR-010, FR-146). */
  async forbiddenDates(executor: Executor, assignees: readonly string[]): Promise<ForbiddenDates> {
    return forbiddenDatesOf(await readCalendars(executor, assignees), assignees)
  }
}

/** The project's plan: its tasks, in the order they were created, and its relations within it. */
export async function readPlan(executor: Executor, projectId: string): Promise<Plan> {
  const rows = await executor
    .select(planColumns)
    .from(tasks)
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.createdAt), asc(tasks.id))
  const blocker = alias(tasks, 'blocker')
  const blockedBy = await executor
    .select({ taskId: taskBlockedBy.taskId, blockerId: taskBlockedBy.blockerId })
    .from(taskBlockedBy)
    .innerJoin(tasks, eq(tasks.id, taskBlockedBy.taskId))
    .innerJoin(blocker, eq(blocker.id, taskBlockedBy.blockerId))
    .where(and(eq(tasks.projectId, projectId), eq(blocker.projectId, projectId)))
  return { tasks: rows, blockedBy }
}

/** The global calendar, and the days off of the given people. */
export async function readCalendars(
  executor: Executor,
  people: readonly string[],
): Promise<Calendars> {
  const [row] = await executor
    .select({ weekendDays: globalCalendar.weekendDays })
    .from(globalCalendar)
  const holidays = await executor.select({ date: companyHolidays.date }).from(companyHolidays)
  const personal = new Map<string, string[]>()
  if (people.length > 0) {
    const rows = await executor
      .select({ accountId: personalHolidays.accountId, date: personalHolidays.date })
      .from(personalHolidays)
      .where(inArray(personalHolidays.accountId, [...people]))
    for (const { accountId, date } of rows) {
      const dates = personal.get(accountId)
      if (dates) dates.push(date)
      else personal.set(accountId, [date])
    }
  }
  return {
    weekendDays: row?.weekendDays ?? DEFAULT_WEEKEND_DAYS,
    holidays: holidays.map((holiday) => holiday.date),
    personalHolidays: personal,
  }
}
