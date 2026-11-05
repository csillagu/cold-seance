import { type Calendars, forbiddenDatesOf } from './scheduler.ts'
import { toDay } from './working-days.ts'

/** A scheduled task, as the assignee availability flag detector reads it. */
export interface AvailabilityTask {
  id: string
  projectId: string
  plannedStart: string
  plannedFinish: string
  /** Its duration in working days, if it has one. */
  durationWorkingDays: number | null
  /** Whether it has subtasks, whose dates its own span (FR-006). */
  parent: boolean
  /** Everyone assigned to it, by account id. */
  assignees: readonly string[]
}

/** A day on which one of a task's assigned people is overloaded. */
export interface PersonDay {
  accountId: string
  date: string
}

/** Why a task's assigned people cannot do it in its time (FR-020). */
export interface Unavailability {
  taskId: string
  projectId: string
  /** The days within the task on which one of its assigned people is overloaded (FR-042). */
  overloads: PersonDay[]
  /**
   * Whether holidays leave the task fewer working days from its planned start to its planned
   * finish than its duration: one of its assigned people is on holiday on a day the task was to be
   * worked on.
   */
  holiday: boolean
}

/**
 * The assignee availability flag detector of the service layer (SC-042, DD-039). A task is shown
 * in red when one of its assigned people cannot do it in its time (FR-020): they are overloaded,
 * as the overload detector marks it (FR-042, SC-040), or on holiday, on a day within it. Answers,
 * for each such task, why; a task with no assigned people, or no planned dates, is never red here.
 *
 * - **Overloaded:** an assigned person is overloaded on a day from the task's planned start to its
 *   planned finish, both included. A shared person's overload is red to every project involved
 *   (FR-043): each project's tasks that the person is assigned to on that day are red in it.
 * - **On holiday:** the task has fewer working days from its planned start to its planned finish,
 *   counted as the scheduler counts them (FR-007, FR-144), than its duration: a holiday of one of
 *   its assigned people, or of the company, fell on a day it was to be worked on. A holiday the
 *   task was scheduled around takes none of its working days, so it makes nothing red. A task
 *   with no duration, or a parent, whose dates are its subtasks' (FR-006), is not checked for it.
 *
 * It only reports: nothing is moved because of it (FR-148, DD-029).
 *
 * `overloaded` gives each person's overloaded days, `YYYY-MM-DD`.
 */
export function unavailableTasks(
  tasks: readonly AvailabilityTask[],
  overloaded: ReadonlyMap<string, readonly string[]>,
  calendars: Calendars,
): Unavailability[] {
  const found: Unavailability[] = []
  for (const task of tasks) {
    if (task.assignees.length === 0) continue
    const overloads = task.assignees.flatMap((accountId) =>
      (overloaded.get(accountId) ?? [])
        .filter((date) => date >= task.plannedStart && date <= task.plannedFinish)
        .map((date) => ({ accountId, date })),
    )
    overloads.sort((a, b) => a.date.localeCompare(b.date))
    const holiday = isShortOfWorkingDays(task, calendars)
    if (overloads.length > 0 || holiday) {
      found.push({ taskId: task.id, projectId: task.projectId, overloads, holiday })
    }
  }
  return found
}

/**
 * Whether the task has fewer working days from its planned start to its planned finish, given
 * its forbidden dates with its assigned people (FR-007), than its duration.
 */
function isShortOfWorkingDays(task: AvailabilityTask, calendars: Calendars): boolean {
  if (task.parent || task.durationWorkingDays === null) return false
  const forbidden = forbiddenDatesOf(calendars, task.assignees)
  const working = forbidden.workingDaysIn(toDay(task.plannedStart), toDay(task.plannedFinish))
  return working < task.durationWorkingDays
}
