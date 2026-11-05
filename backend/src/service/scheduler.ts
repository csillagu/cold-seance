import type { WEEKDAYS } from '../db/schema.ts'
import { ServiceError } from './errors.ts'
import { type DayNumber, ForbiddenDates, fromDay, toDay } from './working-days.ts'

type Weekday = (typeof WEEKDAYS)[number]

/** A task of a project's plan, as the scheduler reads it. */
export interface PlanTask {
  id: string
  title: string
  /** The task it is a subtask of, if any. */
  parentId: string | null
  plannedStart: string | null
  plannedFinish: string | null
  durationWorkingDays: number | null
  milestoneVariant: 'fixed-date' | 'floating' | null
  /** The date a fixed-date milestone is pinned to (FR-012). */
  milestoneDate: string | null
  /** The date the scheduler last placed a floating milestone on (FR-195), if any. */
  floatingDate: string | null
  /** The people assigned to it, by account id. */
  assignees: readonly string[]
}

/**
 * The plan of one project, as the scheduler works on it: its tasks, in the order they were
 * created, and the blocked-by relations between two of them. A relation to a task of another
 * project is never in it, so nothing in another project can move a task (FR-018).
 */
export interface Plan {
  tasks: readonly PlanTask[]
  blockedBy: readonly { taskId: string; blockerId: string }[]
}

/** The calendars the forbidden dates come from (FR-008 to FR-010, FR-146). */
export interface Calendars {
  weekendDays: readonly Weekday[]
  holidays: readonly string[]
  /** Each person's own days off, by account id; a person who has none may be left out. */
  personalHolidays: ReadonlyMap<string, readonly string[]>
}

/** The dates the scheduler sets on a task. */
export interface ScheduledDates {
  plannedStart: string | null
  plannedFinish: string | null
  /** A floating milestone's date (FR-195); `null` for any other task. */
  floatingDate: string | null
}

/** The forbidden dates of a task with the given assigned people (FR-007 to FR-010, FR-146). */
export function forbiddenDatesOf(
  calendars: Calendars,
  assignees: readonly string[],
): ForbiddenDates {
  const personal = assignees.flatMap((person) => calendars.personalHolidays.get(person) ?? [])
  return new ForbiddenDates(calendars.weekendDays, [...calendars.holidays, ...personal])
}

/**
 * The scheduler of the service layer (DD-046, SC-004): it works through a project's tasks in the
 * order their dependencies impose, in memory, and answers the dates of each task it moves. The
 * same code computes the live plan and a proposal's preview (DD-021).
 *
 * Only what `changed` names, and what depends on it, is scheduled again: every other task keeps
 * the dates it has. So a change that only leaves a task's assigned people unable to do it in its
 * time, such as a new day off or a new assignee, moves nothing (FR-148); nor does an overload,
 * which the scheduler never looks at (FR-044, DD-029).
 *
 * A task scheduled again gets its dates by these rules, each from the dates its blockers and
 * subtasks have by then:
 *
 * - **A fixed-date milestone** stays on the date it is pinned to (FR-012).
 * - **A floating milestone** lies on the date the last of its blockers finishes, and on no date
 *   while none of them has a finish (FR-195).
 * - **A parent** spans its subtasks' dates: from the earliest to the latest of them (FR-006). A
 *   parent none of whose subtasks has a date is scheduled as a task.
 * - **A task blocked by tasks with a finish** starts on its next working day after the last of
 *   them finishes, with no lag (FR-005, DD-030).
 * - **Any task** with a start and a duration finishes on the day its duration, counted over its
 *   working days, runs out (FR-144). Its working days skip its forbidden dates (FR-007): the
 *   global calendar's weekend days and company holidays (FR-010), and the days off of each person
 *   assigned to it (FR-008), or the global calendar's alone for a task with nobody assigned
 *   (FR-009) and for an assigned person who has not filled in their calendar (FR-146).
 *
 * Only the blocked-by relations within the project are in the plan, so nothing another project
 * does moves a task (FR-018); a dependency on another project's milestone is only checked
 * (SC-007). Refused as invalid if a task would run past 9999-12-31.
 */
export function schedule(
  plan: Plan,
  calendars: Calendars,
  changed: Iterable<string>,
): Map<string, ScheduledDates> {
  const nodes = new Map<string, Node>(
    plan.tasks.map((task, index) => [
      task.id,
      { task, index, dates: datesOf(task), blockers: [], subtasks: [], successors: [], waiting: 0 },
    ]),
  )
  const link = (from: Node, to: Node) => {
    from.successors.push(to)
    to.waiting++
  }
  for (const { taskId, blockerId } of plan.blockedBy) {
    const task = nodes.get(taskId)
    const blocker = nodes.get(blockerId)
    if (!task || !blocker || task === blocker) continue
    task.blockers.push(blocker)
    link(blocker, task)
  }
  for (const node of nodes.values()) {
    const parent = node.task.parentId === null ? undefined : nodes.get(node.task.parentId)
    if (!parent) continue
    parent.subtasks.push(node)
    link(node, parent)
  }

  const named = new Set([...changed].filter((id) => nodes.has(id)))
  const dirty = new Set(named)
  const moved = new Map<string, ScheduledDates>()
  for (const node of dependencyOrder([...nodes.values()])) {
    if (!dirty.has(node.task.id)) continue
    const after = scheduleOne(node, calendars)
    const differs = !sameDates(node.dates, after)
    if (differs) {
      node.dates = after
      moved.set(node.task.id, after)
    }
    if (differs || named.has(node.task.id)) {
      for (const next of node.successors) dirty.add(next.task.id)
    }
  }
  return moved
}

/** A task in the scheduler's graph: its dates so far, and what it depends on and what on it. */
interface Node {
  task: PlanTask
  /** Its place in the order the tasks were created. */
  index: number
  dates: ScheduledDates
  blockers: Node[]
  subtasks: Node[]
  /** The tasks it blocks, and its parent: those that depend on it. */
  successors: Node[]
  /** How many tasks it depends on are not yet in the dependency order. */
  waiting: number
}

function scheduleOne(
  { task, dates: own, blockers, subtasks }: Node,
  calendars: Calendars,
): ScheduledDates {
  if (task.milestoneVariant === 'fixed-date') return own
  const lastFinish = latest(blockers.map(endOf))
  if (task.milestoneVariant === 'floating') {
    return { plannedStart: null, plannedFinish: null, floatingDate: lastFinish }
  }
  const spanned = subtasks.flatMap(({ dates }) => [dates.plannedStart, dates.plannedFinish])
  const first = earliest(spanned)
  const last = latest(spanned)
  if (first !== null && last !== null) {
    return { plannedStart: first, plannedFinish: last, floatingDate: null }
  }
  const forbidden = forbiddenDatesOf(calendars, task.assignees)
  const start =
    lastFinish === null
      ? own.plannedStart
      : dateOrRefuse(forbidden.nextWorkingDay(toDay(lastFinish)), task)
  if (start === null) return own
  const duration = task.durationWorkingDays ?? keptWorkingDays(own, forbidden)
  if (duration !== null) {
    const finish = dateOrRefuse(forbidden.finishOf(toDay(start), duration), task)
    return { plannedStart: start, plannedFinish: finish, floatingDate: null }
  }
  // A start and no duration, nor a finish to keep the length of: the finish, if any, is kept,
  // unless the start now comes after it.
  const finish = own.plannedFinish !== null && own.plannedFinish < start ? start : own.plannedFinish
  return { plannedStart: start, plannedFinish: finish, floatingDate: null }
}

/** The latest of the dates, or `null` if there is none. */
function latest(dates: readonly (string | null)[]): string | null {
  return dates.reduce<string | null>((a, b) => (a === null || (b !== null && b > a) ? b : a), null)
}

/** The earliest of the dates, or `null` if there is none. */
function earliest(dates: readonly (string | null)[]): string | null {
  return dates.reduce<string | null>((a, b) => (a === null || (b !== null && b < a) ? b : a), null)
}

/**
 * The working days a task with a start and a finish but no duration takes, so that it keeps them
 * when it moves; `null` if it lacks either date.
 */
function keptWorkingDays(own: ScheduledDates, forbidden: ForbiddenDates): number | null {
  if (own.plannedStart === null || own.plannedFinish === null) return null
  return Math.max(1, forbidden.workingDaysIn(toDay(own.plannedStart), toDay(own.plannedFinish)))
}

/** The day a blocker finishes: a milestone's date, or a task's planned finish. */
function endOf({ task, dates }: Node): string | null {
  if (task.milestoneVariant === 'fixed-date') return task.milestoneDate
  if (task.milestoneVariant === 'floating') return dates.floatingDate
  return dates.plannedFinish
}

function dateOrRefuse(day: DayNumber | null, task: PlanTask): string {
  if (day === null) {
    throw new ServiceError(
      'invalid',
      `This change would schedule the task "${task.title}" past 9999-12-31, the last date the tool takes`,
    )
  }
  return fromDay(day)
}

function datesOf(task: PlanTask): ScheduledDates {
  return {
    plannedStart: task.plannedStart,
    plannedFinish: task.plannedFinish,
    floatingDate: task.floatingDate,
  }
}

function sameDates(a: ScheduledDates, b: ScheduledDates): boolean {
  return (
    a.plannedStart === b.plannedStart &&
    a.plannedFinish === b.plannedFinish &&
    a.floatingDate === b.floatingDate
  )
}

/**
 * The tasks in an order in which each comes after everything it depends on: its blockers and its
 * subtasks. Among tasks free to come next, the one created first comes first. The blocked-by
 * relations hold no cycle (FR-014), nor do the subtask relations, but a task blocked by its own
 * parent, or by a task that depends on it through a subtask, closes one through both kinds; the
 * tasks such a cycle holds up come last, in the order they were created, each scheduled once, from
 * the dates the others have by then: the rules of such a cycle cannot all hold at once, and
 * scheduling it again would only push its tasks later each time.
 */
function dependencyOrder(nodes: readonly Node[]): Node[] {
  const ready = nodes.filter((node) => node.waiting === 0)
  const order: Node[] = []
  for (;;) {
    ready.sort((a, b) => a.index - b.index)
    const node = ready.shift()
    if (node === undefined) break
    order.push(node)
    for (const next of node.successors) {
      next.waiting--
      if (next.waiting === 0) ready.push(next)
    }
  }
  const placed = new Set(order)
  return [...order, ...nodes.filter((node) => !placed.has(node))]
}
